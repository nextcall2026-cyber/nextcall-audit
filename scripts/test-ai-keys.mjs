import fs from "fs";

const envText = fs.readFileSync(".env", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const mask = (s) => (s ? s.slice(0, 6) + "…(len " + s.length + ")" : "(missing)");

async function trySlot(n) {
  const base = env[`FREE${n}_BASE_URL`];
  const key = env[`FREE${n}_ACCESS`];
  const model = env[`FREE${n}_MODEL`];
  if (!base || !key || !model) {
    console.log(`FREE${n}: not configured in .env`);
    return;
  }
  const t0 = Date.now();
  try {
    const res = await fetch(base.replace(/\/+$/, "") + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: 'Reply with JSON only, no markdown: {"ok":true}' }],
        max_tokens: 40,
        temperature: 0,
      }),
      signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    console.log(
      `FREE${n}: host=${new URL(base).host} model=${model} key=${mask(key)} status=${res.status} ${Date.now() - t0}ms body=${text.slice(0, 300).replace(/\s+/g, " ")}`
    );
  } catch (e) {
    console.log(
      `FREE${n}: host=${new URL(base).host} model=${model} key=${mask(key)} FETCH-ERROR ${Date.now() - t0}ms ${e.name}: ${e.message}`
    );
  }
}

async function tryGemini() {
  const key = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  if (!key) {
    console.log("GEMINI: not configured in .env");
    return;
  }
  const t0 = Date.now();
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: 'Reply with JSON only, no markdown: {"ok":true}' }] }],
          generationConfig: { maxOutputTokens: 40, temperature: 0 },
        }),
        signal: AbortSignal.timeout(30000),
      }
    );
    const text = await res.text();
    console.log(
      `GEMINI: model=${model} key=${mask(key)} status=${res.status} ${Date.now() - t0}ms body=${text.slice(0, 300).replace(/\s+/g, " ")}`
    );
  } catch (e) {
    console.log(`GEMINI: model=${model} key=${mask(key)} FETCH-ERROR ${Date.now() - t0}ms ${e.name}: ${e.message}`);
  }
}

for (const n of [1, 2, 3, 4, 5]) await trySlot(n);
await tryGemini();
