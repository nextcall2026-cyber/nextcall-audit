/**
 * Read-only diagnostic: why is there capacity left today but no more sends?
 *
 * Answers, from the database rather than from guesses:
 *   - how many SENT records exist since 00:00 UTC, split by the raw provider
 *     field (including records with no provider at all)
 *   - the first and last send time per provider, which shows whether a
 *     provider stopped early or simply ran out of candidates
 *   - every FAILED record today with its error text
 *   - how many prospects are actually still sendable, and how many of those
 *     have no contact email (which would leave capacity unused)
 *
 * Usage: node scripts/diagnose-sends.mjs
 */
import { readFileSync } from "node:fs";
import { DataAPIClient } from "@datastax/astra-db-ts";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const idx = line.indexOf("=");
      let value = line.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      return [line.slice(0, idx).trim(), value];
    })
);

const client = new DataAPIClient(env.ASTRA_DB_APPLICATION_TOKEN, {
  timeoutDefaults: { generalMethodTimeoutMs: 120_000, requestTimeoutMs: 120_000 },
});
const db = client.db(env.ASTRA_DB_API_ENDPOINT);

const today = new Date().toISOString().slice(0, 10);
const sinceIso = `${today}T00:00:00.000Z`;
console.log(`day boundary (UTC): ${sinceIso}`);
console.log(`now:                ${new Date().toISOString()}\n`);

// ---------------------------------------------------------------- outreach
const outreach = await db.collection("outreach").find({}, { limit: 5000 }).toArray();
const sentToday = outreach.filter((r) => r.sentAt && r.sentAt >= sinceIso && r.status === "SENT");

console.log(`SENT records today: ${sentToday.length}`);

const byProvider = new Map();
for (const record of sentToday) {
  const key = record.provider ?? "(missing → counted as resend)";
  byProvider.set(key, (byProvider.get(key) ?? 0) + 1);
}
console.log("\n-- raw provider field --");
for (const [key, count] of [...byProvider.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${key}`);
}

console.log("\n-- first / last send per provider --");
const spans = new Map();
for (const record of sentToday) {
  const key = record.provider ?? "(missing)";
  const at = record.sentAt;
  const span = spans.get(key) ?? { count: 0, first: at, last: at };
  span.count += 1;
  if (at < span.first) span.first = at;
  if (at > span.last) span.last = at;
  spans.set(key, span);
}
for (const [key, span] of spans.entries()) {
  console.log(`  ${key.padEnd(26)} ${span.count} sends   ${span.first} -> ${span.last}`);
}

const timeline = [...sentToday].sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)));
console.log("\n-- last 15 sends today --");
for (const record of timeline.slice(-15)) {
  console.log(
    `  ${String(record.sentAt).slice(11, 19)}Z  ${String(record.provider ?? "(none)").padEnd(8)}  ${record.recipient ?? "?"}  ${String(record.subject ?? "").slice(0, 44)}`
  );
}

// any status other than SENT that was touched today
const otherToday = outreach.filter(
  (r) => r.sentAt && r.sentAt >= sinceIso && r.status !== "SENT"
);
console.log(`\n-- non-SENT records today: ${otherToday.length} --`);
for (const record of otherToday.slice(0, 20)) {
  console.log(
    `  ${String(record.sentAt).slice(11, 19)}Z  ${record.status}  ${record.recipient ?? "?"}  err=${String(record.error ?? "-").slice(0, 90)}`
  );
}

const failedAll = outreach.filter((r) => r.status === "FAILED");
console.log(`\n-- FAILED records (any time, newest 10 of ${failedAll.length}) --`);
for (const record of failedAll.slice(0, 10)) {
  console.log(`  ${String(record.sentAt ?? "").slice(0, 19)}  err=${String(record.error ?? "-").slice(0, 110)}`);
}

// --------------------------------------------------------------- prospects
const prospects = await db.collection("prospects").find({}, { limit: 5000 }).toArray();
console.log(`\nprospects: ${prospects.length}`);

const statusCounts = new Map();
for (const p of prospects) {
  const key = `${p.pipelineStatus} / ${p.outreachState}${p.isSuppressed ? " / SUPPRESSED" : ""}`;
  statusCounts.set(key, (statusCounts.get(key) ?? 0) + 1);
}
console.log("\n-- pipelineStatus / outreachState --");
for (const [key, count] of [...statusCounts.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(4)}  ${key}`);
}

const sendable = prospects.filter(
  (p) => p.pipelineStatus === "NEW" && p.outreachState === "UNCONTACTED" && !p.isSuppressed
);
const withEmail = sendable.filter((p) => p.contactEmail);
console.log(`\n-- auto-send candidates --`);
console.log(`  NEW + UNCONTACTED + not suppressed : ${sendable.length}`);
console.log(`  ...of those with a contact email  : ${withEmail.length}`);
console.log(`  ...without a contact email        : ${sendable.length - withEmail.length}`);

process.exit(0);