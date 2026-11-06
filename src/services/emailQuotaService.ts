import "server-only";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import {
  EMAIL_PROVIDER_ORDER,
  ProviderCapacity,
  buildSendPlan,
} from "@/lib/emailRouting";
import { EmailProviderName } from "@/types";
import { QuotaGateway } from "@/services/emailProvider";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { providerExhaustionService } from "@/services/providerExhaustionService";

interface UsageCache {
  day: string;
  usage: Record<EmailProviderName, number>;
  seededAt: number;
}

/** Re-read the outreach table at most this often; local increments stay live. */
const RESEED_INTERVAL_MS = 60_000;

/**
 * Daily per-provider usage.
 *
 * The source of truth is the outreach collection: every SENT record carries
 * the provider that carried it, so "how many did each provider send today"
 * survives cold starts, multiple serverless instances and redeploys. That count is
 * cached for a minute and topped up with in-process increments, so a burst of
 * sends does not hit the database for every email.
 *
 * The day boundary is UTC — the same boundary Mailtrap and Resend reset on.
 */
export class EmailQuotaService implements QuotaGateway {
  private cache: UsageCache | null = null;

  getLimits(): Record<EmailProviderName, number> {
    return {
      mailgun: env.EMAIL_DAILY_LIMIT_MAILGUN,
      mailtop: env.EMAIL_DAILY_LIMIT_MAILTOP,
      resend: env.EMAIL_DAILY_LIMIT_RESEND,
    };
  }

  isConfigured(name: EmailProviderName): boolean {
    switch (name) {
      case "mailgun":
        return Boolean(env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN);
      case "mailtop":
        return Boolean(env.MAILTOP_API_KEY);
      case "resend":
        return Boolean(env.RESEND_API_KEY);
    }
  }

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private startOfTodayIso(): string {
    return `${this.today()}T00:00:00.000Z`;
  }

  async getUsage(): Promise<Record<EmailProviderName, number>> {
    const day = this.today();
    const now = Date.now();
    const cached = this.cache?.day === day ? this.cache : null;

    if (cached && now - cached.seededAt < RESEED_INTERVAL_MS) {
      return cached.usage;
    }

    const local = cached?.usage ?? { mailgun: 0, mailtop: 0, resend: 0 };
    let stored = { mailgun: 0, mailtop: 0, resend: 0 };

    try {
      stored = await outreachPersistenceService.countSentSinceByProvider(this.startOfTodayIso());
    } catch (error) {
      logger.warn(`[EmailQuota] Could not read today's sends: ${getErrorMessage(error)}`);
    }

    // Never lose an in-process increment to a slightly stale database read.
    const usage = {
      mailgun: Math.max(local.mailgun, stored.mailgun),
      mailtop: Math.max(local.mailtop, stored.mailtop),
      resend: Math.max(local.resend, stored.resend),
    };

    this.cache = { day, usage, seededAt: now };
    return usage;
  }

  async getCapacities(): Promise<ProviderCapacity[]> {
    const limits = this.getLimits();
    const [usage, exhaustedToday] = await Promise.all([
      this.getUsage(),
      providerExhaustionService.getExhausted(),
    ]);

    return EMAIL_PROVIDER_ORDER.map((name) => {
      const limit = limits[name];
      const used = usage[name];
      const exhausted = Boolean(exhaustedToday[name]);

      return {
        name,
        configured: this.isConfigured(name),
        used,
        limit,
        // A provider that already refused today has nothing left, even when the
        // stored count sits below the configured limit. Counting the arithmetic
        // remaining here is what produced "17 emails left today" that could not
        // be sent — every attempt was rejected by Mailtrap.
        remaining: exhausted ? 0 : Math.max(0, limit - used),
        exhausted,
      };
    });
  }

  async getSendPlan(): Promise<EmailProviderName[]> {
    return buildSendPlan(await this.getCapacities());
  }

  async record(name: EmailProviderName): Promise<void> {
    const usage = await this.getUsage();
    usage[name] += 1;
    logger.info(
      `[EmailQuota] ${name} used ${usage[name]}/${this.getLimits()[name]} today.`
    );
  }

  /**
   * A provider answered "no allowance left" — pin it to its limit so this
   * process stops offering it until the day rolls over.
   */
  async markExhausted(name: EmailProviderName): Promise<void> {
    const usage = await this.getUsage();
    usage[name] = Math.max(usage[name], this.getLimits()[name]);
    logger.warn(`[EmailQuota] ${name} marked exhausted for today.`);

    // Also write it down: the in-memory pin dies with the process, and the next
    // cold start would otherwise re-read 133/150 and retry a provider that has
    // already said no.
    await providerExhaustionService.markExhausted(name);
  }

  /** Test/dev hook: forget the cached counts. */
  resetCache(): void {
    this.cache = null;
    providerExhaustionService.resetCache();
  }
}

export const emailQuotaService = new EmailQuotaService();
