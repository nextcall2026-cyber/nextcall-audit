import fs from "fs";

const envText = fs.readFileSync(".env", "utf8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}

const mask = (s) => (s ? s.slice(0, 6) + "…(len " + s.length + ")" : "(missing)");

async function chat(base, key, body, timeoutMs) {
  const t0 = Date.now();
  const res = await fetch(base.replace(/\/+$/, "") + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  return { res, text, ms: Date.now() - t0 };
}

async function trySlot(n) {
  const base = env[`FREE${n}_BASE_URL`];
  const key = env[`FREE${n}_ACCESS`];
  const model = env[`FREE${n}_MODEL`];
  if (!base || !key || !model) {
    console.log(`FREE${n}: not configured in .env`);
    return false;
  }
  try {
    const { res, text, ms } = await chat(
      base,
      key,
      {
        model,
        messages: [{ role: "user", content: 'Reply with JSON only, no markdown: {"ok":true}' }],
        max_tokens: 40,
        temperature: 0,
      },
      30000
    );
    console.log(
      `FREE${n}: host=${new URL(base).host} model=${model} key=${mask(key)} status=${res.status} ${ms}ms body=${text.slice(0, 200).replace(/\s+/g, " ")}`
    );
    return res.ok;
  } catch (e) {
    console.log(`FREE${n}: host=${new URL(base).host} model=${model} key=${mask(key)} FETCH-ERROR ${e.name}: ${e.message}`);
    return false;
  }
}

async function tryGemini() {
  const key = env.GEMINI_API_KEY;
  const model = env.GEMINI_MODEL || "gemini-2.0-flash";
  if (!key) {
    console.log("GEMINI: not configured in .env");
    return;
  }
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
    console.log(`GEMINI: model=${model} key=${mask(key)} status=${res.status} body=${text.slice(0, 200).replace(/\s+/g, " ")}`);
  } catch (e) {
    console.log(`GEMINI: model=${model} key=${mask(key)} FETCH-ERROR ${e.name}: ${e.message}`);
  }
}

/**
 * Deep check on the FIRST configured slot: verifies the exact request shapes
 * the app depends on (JSON mode, follow-up-sized and report-sized bodies).
 * This catches providers that answer auth fine but break structured output.
 */
async function deepCheck() {
  const n = [1, 2, 3, 4, 5, 6, 7].find(
    (s) => env[`FREE${s}_BASE_URL`] && env[`FREE${s}_ACCESS`] && env[`FREE${s}_MODEL`]
  );
  if (!n) {
    console.log("DEEP CHECK: skipped — no configured FREE slot.");
    return;
  }
  const base = env[`FREE${n}_BASE_URL`];
  const key = env[`FREE${n}_ACCESS`];
  const model = env[`FREE${n}_MODEL`];
  console.log(`DEEP CHECK on FREE${n} (${new URL(base).host}, model=${model}) — JSON-mode shapes the app sends:`);

  const run = async (label, body, timeoutMs) => {
    try {
      const { res, text, ms } = await chat(base, key, body, timeoutMs);
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {}
      const content = parsed?.choices?.[0]?.message?.content ?? "";
      let valid = "n/a";
      try {
        JSON.parse(content);
        valid = "YES";
      } catch {
        valid = content ? "NO" : "n/a";
      }
      console.log(
        `  ${label}: status=${res.status} ${ms}ms model=${parsed?.model ?? "?"} tokens=${parsed?.usage?.completion_tokens ?? "?"} validJson=${valid} err=${parsed?.error?.message ?? parsed?.error ?? "-"}`
      );
      return content;
    } catch (e) {
      console.log(`  ${label}: FETCH-ERROR ${e.name}: ${e.message}`);
      return "";
    }
  };

  await run("tiny", {
    model,
    messages: [{ role: "user", content: 'Reply with JSON only, no markdown: {"ok":true}' }],
    response_format: { type: "json_object" },
    max_tokens: 50,
    temperature: 0,
  }, 120000);

  const fu = await run("followup-shaped (max_tokens 1500)", {
    model,
    messages: [
      { role: "system", content: "You output JSON only." },
      {
        role: "user",
        content:
          'Write a follow-up email as JSON: {"subject": "3-7 words", "body": "60-110 words, 2 short paragraphs, mentions their 4.9 rating across 133 reviews and no online booking", "ctaType": "ASK_INTEREST", "angle": "Appointment Scheduling"}',
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 1500,
    temperature: 0.65,
  }, 120000);
  try {
    console.log("  followup subject=" + JSON.stringify(JSON.parse(fu).subject));
  } catch {}

  const rep = await run("report-shaped (max_tokens 8000)", {
    model,
    messages: [
      { role: "system", content: "You output JSON only." },
      {
        role: "user",
        content:
          "Generate a JSON object with keys: executiveSummary (2 paragraphs, ~200 words), overallAssessment (1 paragraph, ~120 words), strengths (array of 4 strings), opportunities (array of 4 strings), customerExperienceImpact (2 paragraphs, ~200 words), nextCallRelevance (2 paragraphs, ~200 words), recommendedNextSteps (array of 3 strings). Topic: a plumbing business in Texas with no publicly detectable online booking.",
      },
    ],
    response_format: { type: "json_object" },
    max_tokens: 8000,
    temperature: 0.5,
  }, 180000);
  try {
    console.log("  report keys=[" + Object.keys(JSON.parse(rep)).join(",") + "]");
  } catch {}
}

for (const n of [1, 2, 3, 4, 5, 6, 7]) await trySlot(n);
await tryGemini();
await deepCheck();
