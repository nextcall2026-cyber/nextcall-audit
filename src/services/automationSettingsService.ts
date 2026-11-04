import "server-only";

import { env } from "@/lib/env";
import { getSettingsCollection } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * Automation preferences (auto-send of the initial audit email, plus the
 * guardrails that keep cold outreach healthy). One document in the shared
 * `settings` collection.
 *
 * Safe by default: auto-send starts DISABLED and in DRY-RUN, so turning it on
 * is always a deliberate two-step decision. Email may leave at any hour unless
 * a business-hours window is explicitly switched on.
 */

export interface AutomationSettings {
  autoSendEnabled: boolean;
  /** When true nothing is sent — each candidate produces a feed entry instead. */
  dryRun: boolean;
  /** Hard ceiling on initial emails per calendar day (all provider free tiers combined). */
  dailyCap: number;
  /** When false, sending is allowed around the clock. */
  businessHoursEnabled: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
  updatedAt: string;
}

const SETTINGS_DOC_ID = "automation-settings";
/**
 * The most a day can carry: the sum of the configured per-provider limits
 * (Mailgun 100 + Mailtop 150 + Resend 50 = 300 on the defaults). Anything
 * above this could never actually be sent, so the cap is clamped here rather
 * than letting the automation hit a wall.
 */
export const MAX_DAILY_CAP =
  env.EMAIL_DAILY_LIMIT_MAILGUN + env.EMAIL_DAILY_LIMIT_MAILTOP + env.EMAIL_DAILY_LIMIT_RESEND;
export const BUSINESS_HOURS_START = 9;
export const BUSINESS_HOURS_END = 18;

export function defaultAutomationSettings(): AutomationSettings {
  return {
    autoSendEnabled: false,
    dryRun: true,
    dailyCap: 20,
    // Any time of day by default: no hour window to trip over.
    businessHoursEnabled: false,
    startHour: BUSINESS_HOURS_START,
    endHour: BUSINESS_HOURS_END,
    timezone: "Asia/Dhaka",
    updatedAt: new Date(0).toISOString(),
  };
}

function clampInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

/**
 * Coerces a stored document into a complete settings object.
 *
 * Only fields declared on AutomationSettings survive. The stored document also
 * carries the data layer's own key `_id`, and that must never travel back into
 * an update: Astra DB rejects any `$set` that touches `_id` ("_id field cannot
 * be updated using update operators"), so the whole write used to be thrown
 * away while the API still answered 200.
 */
function normalizeSettings(raw: unknown): AutomationSettings {
  const defaults = defaultAutomationSettings();
  const source = (raw ?? {}) as Record<string, unknown>;

  return {
    autoSendEnabled:
      typeof source.autoSendEnabled === "boolean"
        ? source.autoSendEnabled
        : defaults.autoSendEnabled,
    dryRun:
      typeof source.dryRun === "boolean" ? source.dryRun : defaults.dryRun,
    dailyCap: clampInt(source.dailyCap, defaults.dailyCap, 0, MAX_DAILY_CAP),
    businessHoursEnabled:
      typeof source.businessHoursEnabled === "boolean"
        ? source.businessHoursEnabled
        : defaults.businessHoursEnabled,
    startHour: clampInt(source.startHour, defaults.startHour, 0, 23),
    endHour: clampInt(source.endHour, defaults.endHour, 0, 23),
    timezone:
      typeof source.timezone === "string" && source.timezone.trim()
        ? source.timezone.trim()
        : defaults.timezone,
    updatedAt:
      typeof source.updatedAt === "string"
        ? source.updatedAt
        : defaults.updatedAt,
  };
}

/**
 * Exactly the columns written to the settings document — an allow-list, never
 * a spread of whatever came back from the database.
 */
function toDocument(settings: AutomationSettings): Record<string, unknown> {
  return {
    id: SETTINGS_DOC_ID,
    autoSendEnabled: settings.autoSendEnabled,
    dryRun: settings.dryRun,
    dailyCap: settings.dailyCap,
    businessHoursEnabled: settings.businessHoursEnabled,
    startHour: settings.startHour,
    endHour: settings.endHour,
    timezone: settings.timezone,
    updatedAt: settings.updatedAt,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class AutomationSettingsService {
  private async readDocument(): Promise<unknown | null> {
    const collection = await getSettingsCollection();
    return collection.findOne({ id: SETTINGS_DOC_ID });
  }

  /**
   * Stored settings. Throws when storage cannot be read, so the dashboard can
   * say "could not load" instead of showing plausible-looking defaults that
   * are not what is actually saved.
   */
  async getSettings(): Promise<AutomationSettings> {
    return normalizeSettings(await this.readDocument());
  }

  /**
   * Stored settings for the automation paths, which must keep running even if
   * storage hiccups. Defaults are the safe answer: auto-send off.
   */
  async getSettingsOrDefaults(): Promise<AutomationSettings> {
    try {
      return await this.getSettings();
    } catch (error) {
      logger.error(
        "[AutomationSettingsService] Failed to load settings:",
        getErrorMessage(error)
      );
      return defaultAutomationSettings();
    }
  }

  async updateSettings(
    patch: Partial<Omit<AutomationSettings, "updatedAt">>
  ): Promise<AutomationSettings> {
    const current = await this.getSettings();
    const merged = normalizeSettings({ ...current, ...patch });
    const next: AutomationSettings = {
      ...merged,
      updatedAt: new Date().toISOString(),
    };

    try {
      const collection = await getSettingsCollection();
      const result = await collection.updateOne(
        { id: SETTINGS_DOC_ID },
        { $set: toDocument(next) },
        { upsert: true }
      );

      if (!result.matchedCount && !result.upsertedId) {
        throw new Error(
          "The settings document was neither matched nor created by the update."
        );
      }
    } catch (error) {
      logger.error(
        "[AutomationSettingsService] Failed to save settings:",
        getErrorMessage(error)
      );
      throw error;
    }

    // Only report success once the new values are actually in storage.
    await this.assertPersisted(next.updatedAt);
    return next;
  }

  /**
   * Read the document back and confirm it holds the values just written. This
   * is what makes "Saved" mean saved — the old code reported success while the
   * write was rejected, so the previous values came back on the next load.
   */
  private async assertPersisted(expectedUpdatedAt: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const stored = normalizeSettings(await this.readDocument());
      if (stored.updatedAt === expectedUpdatedAt) return;
      await delay(150 * (attempt + 1));
    }

    throw new Error(
      "Settings were written but the stored document did not change."
    );
  }
}

export const automationSettingsService = new AutomationSettingsService();

/** True when `hour` sits inside the configured working window. */
export function isWithinBusinessHours(settings: AutomationSettings, hour: number): boolean {
  if (!settings.businessHoursEnabled) return true;
  const { startHour, endHour } = settings;
  if (startHour === endHour) return true;
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

/** Current hour (0-23) in the given IANA timezone. */
export function currentHourInTimezone(timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).formatToParts(new Date());
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "");
    return Number.isFinite(hour) ? hour % 24 : new Date().getHours();
  } catch {
    return new Date().getHours();
  }
}

/** ISO timestamp for 00:00 today in the given timezone. */
export function startOfDayIso(timeZone: string): string {
  const now = new Date();
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const year = parts.find((p) => p.type === "year")?.value;
    const month = parts.find((p) => p.type === "month")?.value;
    const day = parts.find((p) => p.type === "day")?.value;
    if (year && month && day) {
      return new Date(`${year}-${month}-${day}T00:00:00Z`).toISOString();
    }
  } catch {
    // fall through to the UTC day start
  }
  const utc = new Date();
  utc.setUTCHours(0, 0, 0, 0);
  return utc.toISOString();
}
