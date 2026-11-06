/**
 * Read-only: is the outreach collection bigger than the 5000-row window the
 * other diagnostics use, and how do all-time sends split by provider?
 *
 * If the collection exceeds the window, any "today" count taken from a limited
 * find() is unsound, so this settles it first.
 *
 * Usage: node scripts/diagnose-counts.mjs
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

const collection = db.collection("outreach");
const total = await collection.countDocuments({}, 100_000);
const sentTotal = await collection.countDocuments({ status: "SENT" }, 100_000);
console.log(`outreach documents : ${total}`);
console.log(`status SENT        : ${sentTotal}`);
console.log(`truncation risk    : ${total > 5000 ? "YES — earlier diagnostics were capped at 5000" : "no"}\n`);

// All-time split by the raw provider field.
const all = await collection.find({ status: "SENT" }).toArray();
console.log(`fetched SENT rows  : ${all.length}`);
const byProvider = new Map();
for (const record of all) {
  const key = record.provider ?? "(missing → the app counts it as resend)";
  byProvider.set(key, (byProvider.get(key) ?? 0) + 1);
}
console.log("\n-- all-time SENT by raw provider --");
for (const [key, count] of [...byProvider.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(count).padStart(5)}  ${key}`);
}

// Per provider, the first and last day it was used.
const spans = new Map();
for (const record of all) {
  const key = record.provider ?? "(missing)";
  const day = String(record.sentAt ?? "").slice(0, 10);
  if (!day) continue;
  const span = spans.get(key) ?? { count: 0, first: day, last: day };
  span.count += 1;
  if (day < span.first) span.first = day;
  if (day > span.last) span.last = day;
  spans.set(key, span);
}
console.log("\n-- first / last day each provider was used --");
for (const [key, span] of spans.entries()) {
  console.log(`  ${key.padEnd(44)} ${span.count} sends   ${span.first} .. ${span.last}`);
}

// Today's SENT rows, per hour, so the pause is visible on one line.
const today = new Date().toISOString().slice(0, 10);
const perHour = new Map();
for (const record of all) {
  if (!record.sentAt || !String(record.sentAt).startsWith(today)) continue;
  const key = `${String(record.sentAt).slice(11, 13)}Z ${String(record.provider ?? "(none)")}`;
  perHour.set(key, (perHour.get(key) ?? 0) + 1);
}
console.log(`\n-- ${today} sends per hour --`);
for (const [key, count] of [...perHour.entries()].sort()) {
  console.log(`  ${key.padEnd(18)} ${count}`);
}

process.exit(0);