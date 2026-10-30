import { beforeEach, describe, expect, it, vi } from "vitest";

let stored: Record<string, unknown> | null = null;
const updates: Record<string, unknown>[] = [];

vi.mock("@/lib/db", () => ({
  getSettingsCollection: async () => ({
    async findOne() {
      return stored;
    },
    async updateOne(_filter: unknown, update: unknown) {
      const set = ((update as { $set?: Record<string, unknown> }).$set ?? {});
      updates.push(set);
      stored = { ...(stored ?? {}), ...set };
      return { matchedCount: 1, modifiedCount: 1, upsertedId: null, acknowledged: true };
    },
  }),
}));

const { automationRunLogService, isPassDue } = await import(
  "@/services/automationRunLogService"
);

beforeEach(() => {
  stored = null;
  updates.length = 0;
});

describe("isPassDue", () => {
  const now = Date.parse("2026-10-30T05:00:00.000Z");

  it("is due when nothing has run yet", () => {
    expect(isPassDue(null, now)).toBe(true);
  });

  it("is not due inside the 15-minute window", () => {
    expect(isPassDue("2026-10-30T04:50:00.000Z", now)).toBe(false);
    expect(isPassDue("2026-10-30T04:45:01.000Z", now)).toBe(false);
  });

  it("is due once 15 minutes have passed", () => {
    expect(isPassDue("2026-10-30T04:45:00.000Z", now)).toBe(true);
    expect(isPassDue("2026-10-30T03:00:00.000Z", now)).toBe(true);
  });

  it("treats an unreadable timestamp as due", () => {
    expect(isPassDue("not-a-date", now)).toBe(true);
  });
});

describe("automationRunLogService", () => {
  it("reports empty state before the first pass", async () => {
    expect(await automationRunLogService.getState()).toEqual({
      lastRunAt: null,
      lastResult: null,
    });
  });

  it("records the last pass and reads it back", async () => {
    await automationRunLogService.markRun("12 sent of 63 waiting");
    const state = await automationRunLogService.getState();

    expect(state.lastRunAt).toBeTruthy();
    expect(state.lastResult).toBe("12 sent of 63 waiting");
    expect(updates[0]).toMatchObject({ id: "automation-heartbeat" });
  });

  it("never writes a data-layer `_id`", async () => {
    await automationRunLogService.markRun("test");
    for (const set of updates) {
      expect(set).not.toHaveProperty("_id");
    }
  });
});