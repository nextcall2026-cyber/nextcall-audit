import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the settings save path.
 *
 * The bug these cover: the stored document was spread straight back into the
 * `$set` payload, so it carried the data layer's own `_id`. Astra DB rejects
 * any `$set` that touches `_id`, the service swallowed the error, the API
 * answered 200, the card said "Saved" — and the next load showed the old
 * values (daily cap 100 snapping back to 20).
 */

interface FakeDoc {
  [key: string]: unknown;
}

function createFakeCollection(initial: FakeDoc | null) {
  let stored: FakeDoc | null = initial ? { ...initial } : null;
  const rejectedUpdates: FakeDoc[] = [];
  let failNextWrite: Error | null = null;
  let dropNextWrite = false;

  return {
    async findOne() {
      return stored ? JSON.parse(JSON.stringify(stored)) : null;
    },
    async updateOne(_filter: unknown, update: unknown) {
      const set = ((update as { $set?: FakeDoc }).$set ?? {}) as FakeDoc;
      rejectedUpdates.push(set);

      // Exactly what Astra answers when an update tries to rewrite `_id`.
      if (Object.prototype.hasOwnProperty.call(set, "_id")) {
        throw new Error(
          "The command used the update operator: $set.\n_id field cannot be updated using update operators."
        );
      }

      if (failNextWrite) {
        const error = failNextWrite;
        failNextWrite = null;
        throw error;
      }

      if (dropNextWrite) {
        // The write is acknowledged but never applied.
        dropNextWrite = false;
        return { matchedCount: 1, modifiedCount: 0, upsertedId: null, acknowledged: true };
      }

      stored = { ...(stored ?? {}), ...set };
      return { matchedCount: 1, modifiedCount: 1, upsertedId: null, acknowledged: true };
    },
    // Test helpers
    get stored() {
      return stored;
    },
    get rejectedUpdates() {
      return rejectedUpdates;
    },
    failNextWriteWith(error: Error) {
      failNextWrite = error;
    },
    dropNextWrite() {
      dropNextWrite = true;
    },
  };
}

let collection = createFakeCollection(null);

vi.mock("@/lib/db", () => ({
  getSettingsCollection: async () => collection,
  getNotificationsCollection: async () => {
    throw new Error("not used in these tests");
  },
}));

const { automationSettingsService, isWithinBusinessHours, defaultAutomationSettings } =
  await import("@/services/automationSettingsService");
const { notificationService } = await import("@/services/notificationService");

beforeEach(() => {
  collection = createFakeCollection({
    _id: "5fa9c175-d428-4b5a-a9c1-75d428eb5ac2",
    id: "automation-settings",
    autoSendEnabled: true,
    dryRun: true,
    dailyCap: 20,
    businessHoursEnabled: true,
    startHour: 9,
    endHour: 18,
    timezone: "Asia/Dhaka",
    updatedAt: "2026-10-29T02:47:01.996Z",
  });
});

describe("automationSettingsService.getSettings", () => {
  it("drops the storage-level _id instead of handing it to callers", async () => {
    const settings = await automationSettingsService.getSettings();

    expect(settings).not.toHaveProperty("_id");
    expect(Object.keys(settings)).not.toContain("_id");
    expect(settings.dailyCap).toBe(20);
    expect(settings.timezone).toBe("Asia/Dhaka");
  });
});

describe("automationSettingsService.updateSettings", () => {
  it("saves a daily cap of 100 and keeps it on the next load", async () => {
    const saved = await automationSettingsService.updateSettings({ dailyCap: 100 });
    const reloaded = await automationSettingsService.getSettings();

    expect(saved.dailyCap).toBe(100);
    expect(reloaded.dailyCap).toBe(100);
    // No write in this test may ever carry `_id`.
    for (const set of collection.rejectedUpdates) {
      expect(set).not.toHaveProperty("_id");
    }
  });

  it("switches sending to any hour of the day and persists it", async () => {
    await automationSettingsService.updateSettings({ businessHoursEnabled: false });
    const reloaded = await automationSettingsService.getSettings();

    expect(reloaded.businessHoursEnabled).toBe(false);
    expect(isWithinBusinessHours(reloaded, 2)).toBe(true);
    expect(isWithinBusinessHours(reloaded, 23)).toBe(true);
    expect(isWithinBusinessHours(reloaded, 12)).toBe(true);
  });

  it("reports a rejected write as an error instead of a fake success", async () => {
    collection.failNextWriteWith(new Error("storage rejected the write"));

    await expect(
      automationSettingsService.updateSettings({ dailyCap: 100 })
    ).rejects.toThrow(/storage rejected the write/);
  });

  it("fails loudly when the write is acknowledged but nothing changed", async () => {
    collection.dropNextWrite();

    await expect(
      automationSettingsService.updateSettings({ dailyCap: 100 })
    ).rejects.toThrow(/did not change/);
  }, 10_000);
});

describe("automationSettingsService defaults", () => {
  it("allows sending at any hour and keeps auto-send off until asked", () => {
    const defaults = defaultAutomationSettings();

    expect(defaults.businessHoursEnabled).toBe(false);
    expect(defaults.autoSendEnabled).toBe(false);
    expect(defaults.dryRun).toBe(true);
    expect(isWithinBusinessHours(defaults, 3)).toBe(true);
  });

  it("still honours an explicitly configured business-hours window", () => {
    const settings = {
      ...defaultAutomationSettings(),
      businessHoursEnabled: true,
      startHour: 9,
      endHour: 18,
    };

    expect(isWithinBusinessHours(settings, 8)).toBe(false);
    expect(isWithinBusinessHours(settings, 9)).toBe(true);
    expect(isWithinBusinessHours(settings, 17)).toBe(true);
    expect(isWithinBusinessHours(settings, 18)).toBe(false);
  });
});

describe("notificationService settings", () => {
  beforeEach(() => {
    collection = createFakeCollection({
      _id: "0d3f7c58-9f1e-4c8d-9b0a-1f2e3d4c5b6a",
      id: "notification-settings",
      enabled: { EMAIL_SENT: false },
      quietHoursEnabled: true,
      quietStartHour: 22,
      quietEndHour: 7,
      timezone: "Asia/Dhaka",
      updatedAt: "2026-10-29T02:47:01.996Z",
    });
  });

  it("reads switches without leaking _id", async () => {
    const settings = await notificationService.getSettings();

    expect(settings).not.toHaveProperty("_id");
    expect(settings.enabled.EMAIL_SENT).toBe(false);
    expect(settings.quietHoursEnabled).toBe(true);
  });

  it("saves a switch and keeps it on the next load", async () => {
    await notificationService.updateSettings({ quietHoursEnabled: false });
    const reloaded = await notificationService.getSettings();

    expect(reloaded.quietHoursEnabled).toBe(false);
    for (const set of collection.rejectedUpdates) {
      expect(set).not.toHaveProperty("_id");
    }
  });

  it("reports a rejected write as an error", async () => {
    collection.failNextWriteWith(new Error("storage rejected the write"));

    await expect(
      notificationService.updateSettings({ quietHoursEnabled: false })
    ).rejects.toThrow(/storage rejected the write/);
  });
});