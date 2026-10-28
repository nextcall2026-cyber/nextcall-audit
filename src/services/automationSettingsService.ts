import "server-only";

import { getSettingsCollection } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * Automation preferences (auto-send of the initial audit email, plus the
 * guardrails that keep cold outreach healthy). One document in the shared
 * `settings` collection.
 *
 * Safe by default: auto-send starts DISABLED and in DRY-RUN, so turning it on
 * is always a deliberate two-step decision.
 */

export interface AutomationSettings {
  autoSendEnabled: boolean;
  /** When true nothing is sent — each candidate produces a feed entry instead. */
  dryRun: boolean;
  /** Hard ceiling on initial emails per calendar day (Resend free tier = 100/day). */
  dailyCap: number;
  businessHoursEnabled: boolean;
  startHour: number;
  endHour: number;
  timezone: string;
  updatedAt: string;
}

const SETTINGS_DOC_ID = "automation-settings";

export function defaultAutomationSettings(): AutomationSettings {
  return {
    autoSendEnabled: false,
    dryRun: true,
    dailyCap: 20,
    businessHoursEnabled: true,
    startHour: 9,
    endHour: 18,
    timezone: "Asia/Dhaka",
    updatedAt: new Date(0).toISOString(),
  };
}

class AutomationSettingsService {
  async getSettings(): Promise<AutomationSettings> {
    const defaults = defaultAutomationSettings();
    try {
      const collection = await getSettingsCollection();
      const doc = (await collection.findOne({ id: SETTINGS_DOC_ID })) as
        | Partial<AutomationSettings>
        | null;
      if (!doc) return defaults;
      return { ...defaults, ...doc };
    } catch (error) {
      logger.error(
        "[AutomationSettingsService] Failed to load settings:",
        getErrorMessage(error)
      );
      return defaults;
    }
  }

  async updateSettings(
    patch: Partial<Omit<AutomationSettings, "updatedAt">>
  ): Promise<AutomationSettings> {
    const current = await this.getSettings();
    const next: AutomationSettings = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    try {
      const collection = await getSettingsCollection();
      await collection.updateOne(
        { id: SETTINGS_DOC_ID },
        { $set: { ...next, id: SETTINGS_DOC_ID } },
        { upsert: true }
      );
    } catch (error) {
      logger.error(
        "[AutomationSettingsService] Failed to save settings:",
        getErrorMessage(error)
      );
    }

    return next;
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
