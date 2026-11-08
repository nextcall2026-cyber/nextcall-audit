import "server-only";

import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import {
  EMAIL_PROVIDER_LABELS,
  ProviderCapacity,
  describeCapacity,
  totalRemaining,
} from "@/lib/emailRouting";
import { EmailProviderName } from "@/types";
import {
  EmailErrorKind,
  IEmailProvider,
  QuotaGateway,
  SendEmailInput,
  SendEmailOutput,
} from "@/services/emailProvider";
import { mailgunEmailService } from "@/services/mailgunEmailService";
import { mailtopEmailService } from "@/services/mailtopEmailService";
import { resendEmailService } from "@/services/resendEmailService";
import { emailQuotaService } from "@/services/emailQuotaService";

/**
 * The single entry point every send goes through.
 *
 * Three providers, one budget: Mailgun takes the first 100 emails of the day,
 * Mailtop (Mailtrap) the next 150, and Resend carries the last 50 — 300 sends
 * in total across the three free tiers. When every tier is spent the send
 * fails with a message
 * that names the quotas, which is the same signal the automation pass uses to
 * stop instead of burning a PDF render per prospect.
 *
 * Failover rules (see EmailErrorKind):
 *   quota / auth  → nothing was sent, so the next provider gets the email
 *   transient / permanent → the email may already be out, so it stops here
 */
export class EmailService {
  constructor(
    private readonly providers: Partial<Record<EmailProviderName, IEmailProvider>> = {
      mailgun: mailgunEmailService,
      mailtop: mailtopEmailService,
      resend: resendEmailService,
    },
    private readonly quota: QuotaGateway = emailQuotaService
  ) {}

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    const plan = await this.quota.getSendPlan();

    if (plan.length === 0) {
      const capacities = await this.quota.getCapacities();
      const error = this.exhaustedMessage(capacities);
      logger.warn(`[EmailService] ${error}`);
      return {
        success: false,
        providerMessageId: null,
        provider: null,
        error,
        errorKind: "quota",
      };
    }

    const failures: string[] = [];
    let lastKind: EmailErrorKind = "quota";

    for (const name of plan) {
      const provider = this.providers[name];
      const label = EMAIL_PROVIDER_LABELS[name];

      if (!provider || !provider.isConfigured()) {
        failures.push(`${label}: not configured`);
        continue;
      }

      let result: SendEmailOutput;
      try {
        result = await provider.send(input);
      } catch (error) {
        // A provider that throws instead of returning an error still must not
        // be retried elsewhere — the request may have been accepted.
        const message = getErrorMessage(error);
        logger.error(`[EmailService] ${label} threw: ${message}`);
        failures.push(`${label}: ${message}`);
        return {
          success: false,
          providerMessageId: null,
          provider: name,
          error: failures.join(" | "),
          errorKind: "transient",
        };
      }

      if (result.success) {
        await this.quota.record(name);
        logger.info(`[EmailService] Sent via ${label} to ${input.to}.`);
        return result;
      }

      lastKind = result.errorKind ?? "permanent";
      failures.push(result.error ?? `${label} failed`);

      if (lastKind === "quota") {
        // Keep the provider's own words with the flag — at 68/100, "limit
        // reached" is not obviously a daily allowance problem.
        await this.quota.markExhausted(name, result.error);
        logger.warn(`[EmailService] ${label} is out of allowance, trying the next provider.`);
        continue;
      }

      if (lastKind === "auth") {
        logger.warn(`[EmailService] ${label} rejected the credentials, trying the next provider.`);
        continue;
      }

      logger.error(`[EmailService] ${label} failed (${lastKind}); not retrying elsewhere.`);
      return {
        success: false,
        providerMessageId: null,
        provider: name,
        error: failures.join(" | "),
        errorKind: lastKind,
      };
    }

    return {
      success: false,
      providerMessageId: null,
      provider: null,
      error: failures.join(" | ") || "No email provider could accept the message.",
      errorKind: lastKind,
    };
  }

  /**
   * Says exactly how much is left, and mentions "quota" so the auto-send pass
   * recognises it as a provider-wide stop rather than a per-prospect skip.
   */
  private exhaustedMessage(capacities: ProviderCapacity[]): string {
    const configured = capacities.filter((c) => c.configured);

    if (configured.length === 0) {
      return "No email provider is configured. Set MAILGUN_API_KEY, MAILTOP_API_KEY and RESEND_API_KEY.";
    }

    const remaining = totalRemaining(configured);
    return `Daily email sending quota reached on every provider (${describeCapacity(
      configured
    )}) — ${remaining} sends left today. Sending resumes after 00:00 UTC.`;
  }
}

export const emailService = new EmailService();
