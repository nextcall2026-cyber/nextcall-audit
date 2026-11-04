/**
 * Live smoke test for the three email providers.
 *
 * Sends one plain-text email per provider to the app's own from-address
 * (audit@getnextcall.com) using the credentials in .env, so nothing lands in a
 * stranger's inbox. Run from the project root:
 *
 *   node scripts/test-email-providers.mjs
 *
 * The script talks to the provider HTTP APIs directly (the same request shapes
 * the services in src/services use) so a failure names the exact provider and
 * the provider's own error message.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Minimal .env reader (KEY=VALUE lines, quotes stripped, no interpolation). */
function loadEnv() {
  const env = {};
  const text = readFileSync(join(__dirname, "..", ".env"), "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

const env = loadEnv();
const TO = env.MAILGUN_FROM_EMAIL || env.RESEND_FROM_EMAIL || "audit@getnextcall.com";
const TIMEOUT_MS = 25_000;

function stamp() {
  return new Date().toISOString().slice(11, 19);
}

async function run(name, fn) {
  try {
    const result = await fn();
    const ok = result.ok;
    console.log(`\n=== [${stamp()}] ${name}: ${ok ? "PASS" : "FAIL"} (HTTP ${result.status}) ===`);
    console.log(result.body);
  } catch (error) {
    console.log(`\n=== [${stamp()}] ${name}: ERROR ===`);
    console.log(String(error && error.stack ? error.stack : error));
  }
}

async function post(url, headers, body) {
  const response = await fetch(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let text = "";
  try {
    text = await response.text();
  } catch {
    text = "(no response body)";
  }
  return { ok: response.ok, status: response.status, body: text };
}

// 1. Mailgun — POST /v3/{domain}/messages (Basic auth, form fields)
await run("Mailgun", async () => {
  if (!env.MAILGUN_API_KEY || !env.MAILGUN_DOMAIN) {
    return { ok: false, status: 0, body: "MAILGUN_API_KEY / MAILGUN_DOMAIN missing in .env" };
  }
  const form = new URLSearchParams({
    from: TO,
    to: TO,
    subject: "[NextCall] Provider smoke test - Mailgun",
    text: "Mailgun smoke test from scripts/test-email-providers.mjs. If you read this, Mailgun works.",
  });
  return post(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
    authorization: `Basic ${Buffer.from(`api:${env.MAILGUN_API_KEY}`).toString("base64")}`,
    "content-type": "application/x-www-form-urlencoded",
    "user-agent": "nextcall-marketing-app",
  }, form.toString());
});

// 2. Mailtop (Mailtrap) — POST /api/send (Api-Token header, JSON)
await run("Mailtop (Mailtrap)", async () => {
  if (!env.MAILTOP_API_KEY) {
    return { ok: false, status: 0, body: "MAILTOP_API_KEY missing in .env" };
  }
  const base = env.MAILTOP_BASE_URL || "https://send.api.mailtrap.io";
  return post(`${base}/api/send`, {
    "Api-Token": env.MAILTOP_API_KEY,
    "content-type": "application/json",
    "user-agent": "nextcall-marketing-app",
  }, JSON.stringify({
    from: { email: TO },
    to: [{ email: TO }],
    subject: "[NextCall] Provider smoke test - Mailtop (Mailtrap)",
    text: "Mailtop smoke test from scripts/test-email-providers.mjs. If you read this, Mailtop works.",
  }));
});

// 3. Resend — POST /emails (Bearer, JSON)
await run("Resend", async () => {
  if (!env.RESEND_API_KEY) {
    return { ok: false, status: 0, body: "RESEND_API_KEY missing in .env" };
  }
  return post("https://api.resend.com/emails", {
    authorization: `Bearer ${env.RESEND_API_KEY}`,
    "content-type": "application/json",
    "user-agent": "nextcall-marketing-app",
  }, JSON.stringify({
    from: env.RESEND_FROM_EMAIL,
    to: TO,
    subject: "[NextCall] Provider smoke test - Resend",
    text: "Resend smoke test from scripts/test-email-providers.mjs. If you read this, Resend works.",
  }));
});
