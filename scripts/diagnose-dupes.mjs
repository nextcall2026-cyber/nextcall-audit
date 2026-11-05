/**
 * One-off diagnostic: are there duplicate BUSINESSES in Astra, and why did the
 * duplicate check miss them? Reads .env directly, uses the app's own driver.
 * Read-only. Usage: node scripts/diagnose-dupes.mjs
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
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      return [line.slice(0, idx).trim(), value];
    })
);

const client = new DataAPIClient(env.ASTRA_DB_APPLICATION_TOKEN, {
  timeoutDefaults: { generalMethodTimeoutMs: 120_000, requestTimeoutMs: 120_000 },
});
const db = client.db(env.ASTRA_DB_API_ENDPOINT);

const normalizeName = (name) => (name || "").toLowerCase().replace(/[^a-z0-9]/g, "");
const suffixes = /(llc|inc|ltd|llp|corp|corporation|company|co|pc)$/;
const stripSuffix = (value) => {
  let v = value;
  for (let i = 0; i < 3 && suffixes.test(v); i += 1) v = v.replace(suffixes, "");
  return v;
};
const domainOf = (url) => {
  if (!url) return null;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
};
const phoneKey = (phone) => {
  const digits = (phone || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
};

const businesses = await db
  .collection("businesses")
  .find({}, { sort: { createdAt: -1 }, limit: 600 })
  .toArray();

console.log(`businesses scanned: ${businesses.length}`);
for (const b of businesses) {
  console.log(
    `  ${String(b.createdAt).slice(0, 19)} | "${b.name}" | site=${b.website ?? "-"} | ph=${b.phone ?? "-"} | key=${b.dedupeKey ?? "-"}`
  );
}

const audits = await db
  .collection("audits")
  .find({}, { limit: 5000, projection: { businessId: 1 } })
  .toArray();
const auditsPerBusiness = new Map();
for (const a of audits) auditsPerBusiness.set(a.businessId, (auditsPerBusiness.get(a.businessId) || 0) + 1);

const groups = new Map();
for (const b of businesses) {
  const nameKey = stripSuffix(normalizeName(b.name));
  const dom = domainOf(b.website);
  const ph = phoneKey(b.phone);
  const ids = [];
  if (nameKey.length >= 4) ids.push(`n:${nameKey}`);
  if (dom) ids.push(`d:${dom}`);
  if (ph) ids.push(`p:${ph}`);
  for (const id of ids) {
    const list = groups.get(id) || [];
    list.push(b);
    groups.set(id, list);
  }
}

const reported = new Set();
let dupGroups = 0;
for (const [key, list] of groups) {
  if (list.length < 2) continue;
  const unique = [...new Map(list.map((b) => [b.id, b])).values()];
  if (unique.length < 2) continue;
  const sig = unique.map((b) => b.id).sort().join("|");
  if (reported.has(sig)) continue;
  reported.add(sig);
  dupGroups += 1;
  console.log(`\n=== DUPLICATE GROUP (${key}) ===`);
  for (const b of unique) {
    console.log(
      `  ${b.id} | "${b.name}" | website=${b.website ?? "-"} | phone=${b.phone ?? "-"} | dedupeKey=${b.dedupeKey ?? "-"} | dupes=${auditsPerBusiness.get(b.id) || 0} audits | created=${String(b.createdAt).slice(0, 19)}`
    );
  }
}
console.log(`\nduplicate groups: ${dupGroups}`);

const jobs = await db.collection("audit_jobs").find({}, { sort: { createdAt: -1 }, limit: 300 }).toArray();
const dupNotes = jobs.filter((j) => /duplicate/i.test(j.note || ""));
console.log(`recent jobs with a duplicate note: ${dupNotes.length}`);
for (const j of dupNotes.slice(0, 5)) console.log(`  ${j.createdAt} | ${j.businessName} | ${j.note}`);
