/**
 * Read-only: why did Mailgun and Mailtop get marked "limit reached" while their
 * daily counters are far below their configured limits?
 *
 * Prints the persisted exhaustion record and every provider error of today.
 */
import { readFileSync } from "node:fs";
import { DataAPIClient } from "@datastax/astra-db-ts";

const env = Object.fromEntries(
  readFileSync(new URL("../.env", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    })
);

const client = new DataAPIClient(env.ASTRA_DB_APPLICATION_TOKEN, {
  timeoutDefaults: { generalMethodTimeoutMs: 180000, requestTimeoutMs: 180000 },
});
const db = client.db(env.ASTRA_DB_API_ENDPOINT);

const today = new Date().toISOString().slice(0, 10);
console.log("today (UTC):", today, "\n");

// 1. The persisted exhaustion record.
const settings = db.collection("settings");
const doc = await settings.findOne({ id: "email-provider-exhaustion" });
console.log("=== persisted exhaustion record ===");
console.log(JSON.stringify(doc, null, 2));

// 2. Today's sends per provider.
const outreach = db.collection("outreach");
const sent = await outreach.find({ status: "SENT" }, { limit: 900 }).toArray();
const todaySent = sent.filter((r) => r.sentAt && String(r.sentAt).startsWith(today));
const byProvider = new Map();
for (const r of todaySent) byProvider.set(r.provider ?? "(none)", (byProvider.get(r.provider ?? "(none)") ?? 0) + 1);
console.log(`\n=== SENT today: ${todaySent.length} ===`);
for (const [k, v] of byProvider.entries()) console.log(`  ${String(v).padStart(4)}  ${k}`);

// 3. Every failure that names a provider, so the real message is visible.
const failed = await outreach.find({ status: "FAILED" }, { limit: 1000 }).toArray();
const todayFailed = failed.filter((r) => r.sentAt && String(r.sentAt).startsWith(today));
console.log(`\n=== FAILED today: ${todayFailed.length} ===`);
const kinds = new Map();
for (const r of todayFailed) {
  const kind = String(r.error ?? "(none)").replace(/\s+/g, " ").slice(0, 150);
  kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
}
for (const [k, v] of [...kinds.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`  ${String(v).padStart(4)}  ${k}`);
}

process.exit(0);