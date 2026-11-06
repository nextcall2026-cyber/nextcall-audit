import "server-only";

import { getSettingsCollection } from "@/lib/db";
import { getErrorMessage } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { EmailProviderName } from "@/types";

/**
 * Which providers have told us "no allowance left" today, remembered across
 * processes.
 *
 * Why this exists: a provider's real allowance does not always match the number
 * configured in env. Mailtrap refused further mail at 133 sends while
 * EMAIL_DAILY_LIMIT_MAILTOP said 150, so the quota counter kept believing 17
 * sends were available. The first instance knew better — it had the in-memory
 * flag from markExhausted() — and correctly fell through to Resend. Every cold
 * start and every other serverless instance lost that flag, re-read the stored
 * count (133/150), and tried Mailtrap again: one PDF render and one FAILED
 * outreach record per attempt, and a settings page showing capacity that could
 * not be spent.
 *
 * Writing the flag to the settings collection once per provider per UTC day
 * makes every instance agree on what is actually left. The record is scoped to
 * the day, so it expires by itself when the providers reset.
 */

const EXHAUSTION_DOC_ID = "email-provider-exhaustion";

/** Re-read at most this often; the in-process copy stays authoritative between reads. */
const CACHE_TTL_MS = 30_000;

interface ExhaustionDocument {
  id: string;
  /** UTC day these flags belong to, e.g. "2026-11-05". */
  day: string;
  /** Provider → ISO instant it refused. A missing key means it still has room. */
  providers: Partial<Record<EmailProviderName, string>>;
  updatedAt: string;
}

class ProviderExhaustionService {
  private cache:
    | { day: string; providers: Partial<Record<EmailProviderName, string>>; at: number }
    | null = null;

  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  async getExhausted(): Promise<Partial<Record<EmailProviderName, string>>> {
    const day = this.today();

    if (this.cache && this.cache.day === day && Date.now() - this.cache.at < CACHE_TTL_MS) {
      return this.cache.providers;
    }

    let providers: Partial<Record<EmailProviderName, string>> = {};

    try {
      const collection = await getSettingsCollection();
      const doc = (await collection.findOne({
        id: EXHAUSTION_DOC_ID,
      })) as unknown as ExhaustionDocument | null;

      // Yesterday's flags mean nothing today: the providers have reset.
      if (doc && doc.day === day) {
        providers = doc.providers ?? {};
      }
    } catch (error) {
      // A settings read must never block sending. Keep whatever this process
      // already knows rather than pretending every provider has room.
      logger.warn(
        `[ProviderExhaustion] Could not read today's flags: ${getErrorMessage(error)}`
      );
      providers = this.cache?.day === day ? this.cache.providers : {};
    }

    this.cache = { day, providers, at: Date.now() };
    return providers;
  }

  async isExhausted(name: EmailProviderName): Promise<boolean> {
    const providers = await this.getExhausted();
    return Boolean(providers[name]);
  }

  /**
   * Remember that `name` refused today. Best-effort: if the write fails, the
   * in-process cache still keeps this instance honest.
   */
  async markExhausted(name: EmailProviderName): Promise<void> {
    const day = this.today();
    const providers = {
      ...(await this.getExhausted()),
      [name]: new Date().toISOString(),
    };

    this.cache = { day, providers, at: Date.now() };

    try {
      const collection = await getSettingsCollection();
      const document: ExhaustionDocument = {
        id: EXHAUSTION_DOC_ID,
        day,
        providers,
        updatedAt: new Date().toISOString(),
      };
      await collection.updateOne({ id: EXHAUSTION_DOC_ID }, { $set: document }, { upsert: true });
      logger.warn(`[ProviderExhaustion] ${name} recorded as exhausted for ${day}.`);
    } catch (error) {
      logger.warn(
        `[ProviderExhaustion] Could not persist ${name} for ${day}: ${getErrorMessage(error)}`
      );
    }
  }

  /** Test/dev hook: forget the cached flags. */
  resetCache(): void {
    this.cache = null;
  }
}

export const providerExhaustionService = new ProviderExhaustionService();