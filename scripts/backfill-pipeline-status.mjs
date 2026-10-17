/**
 * One-time backfill: align pipelineStatus with outreach history.
 *
 * Before the pipeline-sync fix, sending an email updated outreachState and
 * lastContactedAt but never pipelineStatus, so emailed prospects stayed in
 * NEW / READY_TO_CONTACT and the pipeline's CONTACTED / FOLLOW_UP sections
 * looked empty. This script moves such prospects to the correct stage:
 *
 *   outreachState in (FOLLOW_UP_1_SENT, FOLLOW_UP_2_SENT, FOLLOW_UP_3_SENT,
 *                     CLOSE_LOOP_SENT, COMPLETED)              -> FOLLOW_UP
 *   any other non-UNCONTACTED outreachState (INITIAL_SENT, REPLIED,
 *   BOUNCED, UNSUBSCRIBED, STOPPED)                           -> CONTACTED
 *
 * Prospects already in CONTACTED / FOLLOW_UP / QUALIFIED / CONVERTED /
 * UNQUALIFIED / CLOSED_LOST are left untouched.
 *
 * Idempotent: safe to run multiple times.
 *
 * Usage: node --env-file=.env scripts/backfill-pipeline-status.mjs
 */

import { DataAPIClient } from "@datastax/astra-db-ts";

if (process.env.DATA_MODE === "memory") {
  console.error("DATA_MODE=memory — data is in-memory only, nothing to backfill.");
  process.exit(1);
}

const endpoint = process.env.ASTRA_DB_API_ENDPOINT;
const token = process.env.ASTRA_DB_APPLICATION_TOKEN;
if (!endpoint || !token) {
  console.error("Missing ASTRA_DB_API_ENDPOINT or ASTRA_DB_APPLICATION_TOKEN (load .env via --env-file).");
  process.exit(1);
}

const FOLLOW_UP_STATES = new Set([
  "FOLLOW_UP_1_SENT",
  "FOLLOW_UP_2_SENT",
  "FOLLOW_UP_3_SENT",
  "CLOSE_LOOP_SENT",
  "COMPLETED",
]);
const ELIGIBLE_FROM = new Set(["NEW", "READY_TO_CONTACT"]);

const db = new DataAPIClient(token).db(endpoint);
const prospects = db.collection("prospects");

const docs = await prospects.find({ outreachState: { $ne: "UNCONTACTED" } }).toArray();

let contacted = 0;
let followUp = 0;
let skipped = 0;
let failed = 0;

for (const doc of docs) {
  const from = doc.pipelineStatus;
  if (!ELIGIBLE_FROM.has(from)) {
    skipped++;
    continue;
  }
  const next = FOLLOW_UP_STATES.has(doc.outreachState) ? "FOLLOW_UP" : "CONTACTED";
  const name = doc.businessSnapshot?.name || doc.id;
  try {
    await prospects.updateOne(
      { id: doc.id },
      { $set: { pipelineStatus: next, updatedAt: new Date().toISOString() } }
    );
    if (next === "FOLLOW_UP") followUp++;
    else contacted++;
    console.log(`[backfill] ${name}: ${from} -> ${next} (outreachState=${doc.outreachState})`);
  } catch (err) {
    failed++;
    console.error(`[backfill] FAILED for ${name} (${doc.id}):`, err?.message || err);
  }
}

console.log(
  `Done. scanned=${docs.length} contacted=${contacted} followUp=${followUp} skipped(already staged)=${skipped} failed=${failed}`
);
