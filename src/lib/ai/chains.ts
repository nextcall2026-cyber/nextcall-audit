/**
 * The routing chains, by the exact names configured in FreeLLMAPI.
 *
 * Every chain is exposed by the router as a MODEL NAME, so one API key and one
 * base URL serve all of them — the chain is chosen per request via `model`.
 * That is what lets each worker use its own chain instead of everything
 * competing for one model's rate limit.
 *
 * Names must match the router dashboard character for character (including the
 * "auto:" prefix); a typo shows up as a 400 from the router, not as a silent
 * fallback.
 */

export const AI_CHAINS = {
  /** Google Business Profile screenshot → fields. */
  visionListing: "auto:vision-listing",
  /** Facebook About screenshot → fields (mostly the email). */
  visionSocial: "auto:vision-social",
  /** Website pages → structured facts. Three lanes so parallel scrapers do not
   *  all land on the same model's rate limit at once. */
  bulkLane1: "auto:bulk-lane-1",
  bulkLane2: "auto:bulk-lane-2",
  bulkLane3: "auto:bulk-lane-3",
  /** The personalised audit report. */
  reportMain: "auto:report-main",
  /** Overflow for the report when the main chain is spent. */
  reportBackup: "auto:report-backup",
  /** The per-prospect opening line. */
  copywriter: "auto:copywriter",
  /** Follow-up drafts. */
  followup: "auto:followup",
  /** Subject lines and other micro-copy. */
  microCopy: "auto:micro-copy",
  /** Long-context work: whole-site summary, daily digest. */
  longContext: "auto:longcontext",
} as const;

export type AiChainName = (typeof AI_CHAINS)[keyof typeof AI_CHAINS];

/** Which lane a scraper uses. Lanes share the same model pool, different order. */
export function bulkLaneFor(workerIndex: number): AiChainName {
  const lanes = [AI_CHAINS.bulkLane1, AI_CHAINS.bulkLane2, AI_CHAINS.bulkLane3];
  return lanes[Math.abs(workerIndex) % lanes.length];
}
