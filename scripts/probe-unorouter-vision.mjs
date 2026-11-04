/**
 * unoRouter free-model vision capability probe (dev utility, not shipped logic).
 * Tests each candidate model with a tiny PNG containing "HELLO 42" + a blue
 * square; a model that answers with the text truly sees the image.
 * Usage: $env:UNOROUTER_KEY='<key>'; node scripts/probe-unorouter-vision.mjs
 */
import { readFileSync } from "node:fs";

const KEY = process.env.UNOROUTER_KEY;
const BASE = process.env.PROBE_BASE_URL ?? "https://api.unorouter.com/v1/chat/completions";
const IMAGE = new URL("../.zwork/tmp/vision-test.png", import.meta.url);

const CANDIDATES = [
  "gemini-3.5-flash-lite:free", "gemini-3.6-flash:free", "gpt-4o:free",
  "glm-4.6v-flash:free", "llama-3.2-11b-vision:free", "llama-4-scout:free",
  "mistral-small-3.2:free", "mistral-small-4-119b-2603:free",
  "nemotron-3.5-super-vl:free", "nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "qwen2.5-vl-7b-instruct-awq:free", "qwen2.5-vl-72b-instruct:free",
  "minicpm5-2b:free", "intern-s1:free", "intern-s2-preview:free",
  "dots-3-note-preview:free", "step-5-preview:free", "gemma-4-12b:free",
  "gemma-4-31b-it:free", "minimax-m3.1-flash:free", "agnes-3.0-flash:free",
  "sensenova-6.8-flash-lite:free", "glm-5.3-flash:free", "glm-4.7-flash:free",
];

const b64 = readFileSync(IMAGE).toString("base64");
const dataUrl = `data:image/png;base64,${b64}`;

const SPACING_MS = Number(process.env.SPACING_MS ?? 2_500);
const ARGS = process.argv.slice(2);
const LIST = ARGS.length ? ARGS : CANDIDATES;

async function probe(model) {
  const started = Date.now();
  const timeoutMs = Number(process.env.TIMEOUT_MS ?? 45_000);
  try {
    const res = await fetch(BASE, {
      method: "POST",
      headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        model,
        messages: [{
          role: "user",
          content: [
            { type: "text", text: "Reply with exactly the uppercase text visible in the image, nothing else." },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        }],
        max_tokens: Number(process.env.MAX_TOKENS ?? 2000),
        temperature: 0,
        stream: false,
      }),
    });
    const ms = Date.now() - started;
    const rl = ["x-ratelimit-remaining", "x-ratelimit-limit", "x-ratelimit-reset", "x-ratelimit-requests-remaining"]
      .map((h) => res.headers.get(h) ? `${h}=${res.headers.get(h)}` : null)
      .filter(Boolean)
      .join(" ");
    const bodyText = await res.text();
    if (!res.ok) {
      const reason = bodyText.slice(0, 140).replace(/\s+/g, " ");
      return { model, ok: false, pass: false, ms, note: `HTTP ${res.status}: ${reason}${rl ? ` [${rl}]` : ""}` };
    }
    const json = JSON.parse(bodyText);
    const text = json?.choices?.[0]?.message?.content ?? "";
    const flat = typeof text === "string" ? text : JSON.stringify(text);
    const pass = /HELLO/i.test(flat) && /42/.test(flat);
    return { model, ok: true, pass, ms, note: `${flat.slice(0, 70).replace(/\s+/g, " ")}${rl ? ` [${rl}]` : ""}` };
  } catch (error) {
    return { model, ok: false, pass: false, ms: Date.now() - started, note: error.name === "TimeoutError" ? `TIMEOUT ${timeoutMs / 1000}s` : String(error).slice(0, 110) };
  }
}

const results = [];
const queue = [...LIST];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
while (queue.length) {
  const model = queue.shift();
  const r = await probe(model);
  results.push(r);
  console.error(`[${results.length}/${LIST.length}] ${r.model} → ${r.ok ? (r.pass ? "VISION-OK" : "answered-but-wrong") : "FAIL"} (${r.ms}ms)`);
  if (queue.length) await sleep(SPACING_MS);
}

console.log("\n=== SUMMARY (PASS = read HELLO 42) ===");
for (const r of results.sort((a, b) => (b.pass ? 1 : 0) - (a.pass ? 1 : 0) || a.ms - b.ms)) {
  console.log(`${r.pass ? "PASS" : r.ok ? "WRONG" : "FAIL "} | ${String(r.ms).padStart(6)}ms | ${r.model} | ${r.note}`);
}
