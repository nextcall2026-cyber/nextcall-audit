import "server-only";

import { AppNotification, NotificationSettings, NotificationType } from "@/types";
import {
  CRITICAL_NOTIFICATION_TYPES,
  NOTIFICATION_TYPES,
} from "@/lib/notificationTypes";
import { getNotificationsCollection, getSettingsCollection } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { randomUUID } from "crypto";

/**
 * In-app notification feed for the dashboard.
 *
 * Every notification lives in the `notifications` collection so it survives
 * restarts, and the dashboard bell reads it back. There is no external
 * messaging: this service is the single source of truth for "what happened
 * while I was away".
 *
 * Settings (per-type on/off, quiet hours, timezone) live in the `settings`
 * collection as one document.
 */

export { NOTIFICATION_TYPES };

/** Types that are always delivered, even during quiet hours — losing these
 * would cost real money or reputation (a reply, a bounce, a broken provider). */
const CRITICAL_TYPES: ReadonlySet<NotificationType> = new Set(
  CRITICAL_NOTIFICATION_TYPES
);

const SETTINGS_DOC_ID = "notification-settings";
const DEDUPE_WINDOW_MS = 12 * 60 * 60 * 1000; // 12 hours
const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 200;

export interface NotifyInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Deep link into the dashboard, e.g. /dashboard/pipeline/<prospectId>. */
  href?: string | null;
  prospectId?: string | null;
  businessId?: string | null;
  /** Suppresses repeats of the same event within 12 hours. */
  dedupeKey?: string | null;
  /** Bypasses the enabled/quiet-hours checks (used by system alerts). */
  force?: boolean;
}

function defaultSettings(): NotificationSettings {
  const enabled = {} as Record<NotificationType, boolean>;
  for (const type of NOTIFICATION_TYPES) enabled[type] = true;
  return {
    enabled,
    quietHoursEnabled: false,
    quietStartHour: 22,
    quietEndHour: 7,
    timezone: "Asia/Dhaka",
    updatedAt: new Date(0).toISOString(),
  };
}

function currentHourIn(timeZone: string): number {
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

function isQuietHour(settings: NotificationSettings, hour: number): boolean {
  if (!settings.quietHoursEnabled) return false;
  const start = settings.quietStartHour;
  const end = settings.quietEndHour;
  if (start === end) return false;
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

function clampHour(value: unknown, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(23, Math.max(0, Math.round(parsed)));
}

/**
 * Coerces a stored document into complete settings.
 *
 * Only declared fields survive. The stored document also carries the data
 * layer's own key `_id`, and that must never be written back: Astra DB rejects
 * any `$set` that touches `_id` ("_id field cannot be updated using update
 * operators"), so the entire update was discarded while the API still
 * answered 200 and the card still said "Saved".
 */
function normalizeSettings(raw: unknown): NotificationSettings {
  const defaults = defaultSettings();
  const source = (raw ?? {}) as Record<string, unknown>;
  const storedEnabled = (source.enabled ?? {}) as Record<string, unknown>;

  const enabled = {} as Record<NotificationType, boolean>;
  for (const type of NOTIFICATION_TYPES) {
    enabled[type] =
      typeof storedEnabled[type] === "boolean"
        ? (storedEnabled[type] as boolean)
        : defaults.enabled[type];
  }

  return {
    enabled,
    quietHoursEnabled:
      typeof source.quietHoursEnabled === "boolean"
        ? source.quietHoursEnabled
        : defaults.quietHoursEnabled,
    quietStartHour: clampHour(source.quietStartHour, defaults.quietStartHour),
    quietEndHour: clampHour(source.quietEndHour, defaults.quietEndHour),
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

/** Exactly the columns written to the settings document. */
function toDocument(settings: NotificationSettings): Record<string, unknown> {
  return {
    id: SETTINGS_DOC_ID,
    enabled: settings.enabled,
    quietHoursEnabled: settings.quietHoursEnabled,
    quietStartHour: settings.quietStartHour,
    quietEndHour: settings.quietEndHour,
    timezone: settings.timezone,
    updatedAt: settings.updatedAt,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class NotificationService {
  /**
   * Reads the stored settings, filling in defaults for missing keys. Throws
   * when storage cannot be read, so the dashboard can say "could not load"
   * instead of showing plausible-looking defaults that are not really saved.
   */
  async getSettings(): Promise<NotificationSettings> {
    const collection = await getSettingsCollection();
    const doc = await collection.findOne({ id: SETTINGS_DOC_ID });
    return normalizeSettings(doc);
  }

  /**
   * Settings for the feed itself: it must keep working even when storage
   * hiccups, and the defaults mean "everything on", so no alert is lost.
   */
  async getSettingsOrDefaults(): Promise<NotificationSettings> {
    try {
      return await this.getSettings();
    } catch (error) {
      logger.error(
        "[NotificationService] Failed to load settings:",
        getErrorMessage(error)
      );
      return defaultSettings();
    }
  }

  async updateSettings(
    patch: Partial<Omit<NotificationSettings, "updatedAt">>
  ): Promise<NotificationSettings> {
    const current = await this.getSettings();
    const next = normalizeSettings({
      ...current,
      enabled: { ...current.enabled, ...(patch.enabled ?? {}) },
      quietHoursEnabled: patch.quietHoursEnabled ?? current.quietHoursEnabled,
      quietStartHour: patch.quietStartHour ?? current.quietStartHour,
      quietEndHour: patch.quietEndHour ?? current.quietEndHour,
      timezone: patch.timezone ?? current.timezone,
      updatedAt: new Date().toISOString(),
    });

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
        "[NotificationService] Failed to save settings:",
        getErrorMessage(error)
      );
      throw error;
    }

    // Only report success once the new values are actually in storage.
    await this.assertPersisted(next.updatedAt);
    return next;
  }

  /**
   * Reads the document back and confirms it holds the values just written.
   * This is what makes "Saved" mean saved.
   */
  private async assertPersisted(expectedUpdatedAt: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const collection = await getSettingsCollection();
      const stored = normalizeSettings(
        await collection.findOne({ id: SETTINGS_DOC_ID })
      );
      if (stored.updatedAt === expectedUpdatedAt) return;
      await delay(150 * (attempt + 1));
    }

    throw new Error(
      "Settings were written but the stored document did not change."
    );
  }

  /**
   * Creates a notification unless the type is disabled, the moment falls in
   * quiet hours (non-critical types only), or the same dedupeKey already fired
   * within the last 12 hours.
   */
  async notify(input: NotifyInput): Promise<AppNotification | null> {
    try {
      const settings = await this.getSettingsOrDefaults();

      if (!input.force && settings.enabled[input.type] === false) {
        logger.debug(`[NotificationService] Skipped ${input.type} (disabled).`);
        return null;
      }

      if (
        !input.force &&
        !CRITICAL_TYPES.has(input.type) &&
        isQuietHour(settings, currentHourIn(settings.timezone))
      ) {
        logger.debug(`[NotificationService] Skipped ${input.type} (quiet hours).`);
        return null;
      }

      const collection = await getNotificationsCollection();

      if (input.dedupeKey) {
        const existing = (await collection.findOne({
          dedupeKey: input.dedupeKey,
        })) as AppNotification | null;
        if (
          existing?.createdAt &&
          Date.now() - new Date(existing.createdAt).getTime() < DEDUPE_WINDOW_MS
        ) {
          logger.debug(
            `[NotificationService] Deduped ${input.type} (${input.dedupeKey}).`
          );
          return null;
        }
      }

      const notification: AppNotification = {
        id: randomUUID(),
        type: input.type,
        title: input.title,
        body: input.body ?? null,
        href: input.href ?? null,
        prospectId: input.prospectId ?? null,
        businessId: input.businessId ?? null,
        dedupeKey: input.dedupeKey ?? null,
        read: false,
        createdAt: new Date().toISOString(),
      };

      await collection.insertOne(notification);
      return notification;
    } catch (error) {
      logger.error(
        `[NotificationService] Failed to create ${input.type} notification:`,
        getErrorMessage(error)
      );
      return null;
    }
  }

  async list(options?: {
    limit?: number;
    unreadOnly?: boolean;
    type?: NotificationType;
  }): Promise<AppNotification[]> {
    const limit = Math.min(
      Math.max(1, options?.limit ?? DEFAULT_LIST_LIMIT),
      MAX_LIST_LIMIT
    );
    try {
      const collection = await getNotificationsCollection();
      const filter: Record<string, unknown> = {};
      if (options?.unreadOnly) filter.read = false;
      if (options?.type) filter.type = options.type;

      const cursor = collection.find(filter);
      const docs = (await cursor.toArray()) as unknown as AppNotification[];
      // Sorted in process: keeps the query free of index requirements.
      return docs
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit);
    } catch (error) {
      logger.error(
        "[NotificationService] Failed to list notifications:",
        getErrorMessage(error)
      );
      return [];
    }
  }

  async unreadCount(): Promise<number> {
    try {
      const collection = await getNotificationsCollection();
      const cursor = collection.find({ read: false });
      const docs = await cursor.toArray();
      return docs.length;
    } catch (error) {
      logger.error(
        "[NotificationService] Failed to count unread:",
        getErrorMessage(error)
      );
      return 0;
    }
  }

  async markRead(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    let updated = 0;
    try {
      const collection = await getNotificationsCollection();
      for (const id of ids) {
        const result = await collection.updateOne(
          { id, read: false },
          { $set: { read: true } }
        );
        updated += result.modifiedCount ?? 0;
      }
    } catch (error) {
      logger.error(
        "[NotificationService] Failed to mark read:",
        getErrorMessage(error)
      );
    }
    return updated;
  }

  async markAllRead(): Promise<number> {
    try {
      const collection = await getNotificationsCollection();
      const cursor = collection.find({ read: false });
      const docs = (await cursor.toArray()) as unknown as AppNotification[];
      // Marked one by one: works on both Astra and the in-memory DB shim.
      return await this.markRead(docs.map((d) => d.id));
    } catch (error) {
      logger.error(
        "[NotificationService] Failed to mark all read:",
        getErrorMessage(error)
      );
      return 0;
    }
  }

  /** Housekeeping — called from the automation sweep. */
  async prune(days = 30): Promise<number> {
    try {
      const collection = await getNotificationsCollection();
      const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
      const cursor = collection.find({});
      const docs = (await cursor.toArray()) as unknown as AppNotification[];
      const stale = docs.filter((d) => d.createdAt < cutoff).map((d) => d.id);
      return await this.markDeleted(stale);
    } catch (error) {
      logger.error(
        "[NotificationService] Failed to prune:",
        getErrorMessage(error)
      );
      return 0;
    }
  }

  private async markDeleted(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const collection = await getNotificationsCollection();
    let deleted = 0;
    for (const id of ids) {
      const result = await collection.deleteOne({ id });
      deleted += result.deletedCount ?? 0;
    }
    return deleted;
  }
}

export const notificationService = new NotificationService();
