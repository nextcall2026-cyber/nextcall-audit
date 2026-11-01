import { describe, it, expect } from "vitest";
import { hasBeenEmailed, isProspectUnread } from "@/lib/pipelineReadState";
import { compareProspectsForPipeline } from "@/lib/pipelineSort";
import { Prospect } from "@/types";

function prospect(overrides: Partial<Prospect> = {}): Prospect {
  return {
    id: "p1",
    businessId: "b1",
    businessName: "Test Co",
    pipelineStatus: "NEW",
    outreachState: "UNCONTACTED",
    contactEmail: null,
    auditScore: null,
    priorityScore: null,
    priorityLevel: null,
    viewAddedAt: null,
    lastContactedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  } as Prospect;
}

describe("pipeline read state", () => {
  it("treats a never-opened, never-emailed prospect as unread", () => {
    expect(isProspectUnread(prospect())).toBe(true);
  });

  it("treats an opened prospect as read", () => {
    expect(isProspectUnread(prospect({ viewAddedAt: "2026-01-02T00:00:00.000Z" }))).toBe(false);
  });

  it("treats an emailed prospect as read even without viewAddedAt", () => {
    // The bug this guards: the audit stayed "New" after the email went out.
    expect(isProspectUnread(prospect({ outreachState: "INITIAL_SENT" }))).toBe(false);
    expect(isProspectUnread(prospect({ lastContactedAt: "2026-01-02T00:00:00.000Z" }))).toBe(false);
  });

  it("counts follow-up states as emailed", () => {
    expect(hasBeenEmailed(prospect({ outreachState: "FOLLOW_UP_1_SENT" }))).toBe(true);
  });

  it("sorts emailed prospects out of the unread block", () => {
    const emailed = prospect({
      id: "emailed",
      outreachState: "INITIAL_SENT",
      priorityScore: 10,
      createdAt: "2026-01-05T00:00:00.000Z",
    });
    const fresh = prospect({ id: "fresh", createdAt: "2026-01-03T00:00:00.000Z" });

    expect(compareProspectsForPipeline(fresh, emailed)).toBeLessThan(0);
  });
});
