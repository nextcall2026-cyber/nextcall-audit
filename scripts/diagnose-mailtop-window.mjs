/**
 * Read-only: does Mailtrap count a rolling 24h window instead of UTC midnight?
 *
 * The router counts from 00:00 UTC, so it believed Mailtop still had 17 sends
 * left at the moment Mailtrap answered "daily sending limit reached". If
 * Mailtrap's window is rolling, sends from the previous evening are still
 * inside it and eat that tail. This prints the counts for both windows.
 *
 * Usage: node scripts/diagnose-mailtop-window.mjs
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

const outreach = await db.collection("outreach").find({}, { limit: 5000 }).toArray();
const mailtop = outreach
  .filter((r) => r.status === "SENT" && r.provider === "mailtop" && r.sentAt)
  .sort((a, b) => String(a.sentAt).localeCompare(String(b.sentAt)));

// The instant Mailtrap first refused today, from the FAILED record at 17:11:53Z.
const refusedAt = "2026-11-05T17:11:53.000Z";
const rollingStart = new Date(Date.parse(refusedAt) - 24 * 3600 * 1000).toISOString();

const utcDayStart = "2026-11-05T00:00:00.000Z";

const inUtcDay = mailtop.filter((r) => r.sentAt >= utcDayStart && r.sentAt <= refusedAt);
const inRolling = mailtop.filter((r) => r.sentAt >= rollingStart && r.sentAt <= refusedAt);

console.log(`Mailtrap refused at : ${refusedAt}`);
console.log(`00:00 UTC window    : ${inUtcDay.length} sends  (router believes 150 - ${inUtcDay.length} = ${150 - inUtcDay.length} left)`);
console.log(`rolling 24h window  : ${inRolling.length} sends  (started ${rollingStart})`);
console.log("");

const before = mailtop.filter((r) => r.sentAt < utcDayStart).slice(-25);
console.log(`-- mailtop sends on the previous UTC day (last ${before.length}) --`);
for (const record of before) {
  console.log(`  ${String(record.sentAt).slice(0, 19)}  ${record.recipient ?? "?"}`);
}

console.log("\n-- mailtop sends just before midnight UTC (count per hour) --");
const perHour = new Map();
for (const record of mailtop) {
  if (record.sentAt < "2026-11-04T12:00:00.000Z") continue;
  const hour = String(record.sentAt).slice(0, 13);
  perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
}
for (const [hour, count] of [...perHour.entries()].sort()) {
  console.log(`  ${hour}:00Z  ${count}`);
}

// Does Mailtrap also count attempts it rejected? 133 accepted + 17 rejected
// would be exactly the 150 the account reports as spent.
const failedMailtop = outreach.filter(
  (r) => r.status === "FAILED" && /^Mailtop:/i.test(String(r.error ?? ""))
);
const failedToday = failedMailtop.filter(
  (r) => r.sentAt && r.sentAt >= utcDayStart && r.sentAt <= refusedAt
);
console.log(`\n-- failed Mailtop attempts before the refusal --`);
console.log(`  all time: ${failedMailtop.length}   today before 17:11:53Z: ${failedToday.length}`);
for (const record of failedToday) {
  console.log(`  ${String(record.sentAt).slice(11, 19)}Z  ${record.recipient ?? "?"}  ${String(record.error ?? "").slice(0, 80)}`);
}

const allFailedToday = outreach.filter(
  (r) => r.status === "FAILED" && r.sentAt && r.sentAt >= utcDayStart && r.sentAt <= refusedAt
);
const byKind = new Map();
for (const record of allFailedToday) {
  const kind = String(record.error ?? "(none)").split(":")[0].slice(0, 46);
  byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
}
console.log(`\n-- every FAILED attempt today before the refusal: ${allFailedToday.length} --`);
for (const [kind, count] of [...byKind.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(3)}  ${kind}`);
}

process.exit(0);