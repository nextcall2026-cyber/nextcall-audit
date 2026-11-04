/** One-off: NVIDIA vision extraction on a real screenshot -> JSON fields. */
import { readFileSync } from "node:fs";

const KEY = process.env.UNOROUTER_KEY;
const BASE = process.env.PROBE_BASE_URL ?? "https://integrate.api.nvidia.com/v1/chat/completions";
const model = process.argv[2];
const imagePath = process.argv[3];

const PROMPT = `This is a screenshot related to a local business (Google Maps listing, or its Details/About panel, or a Facebook page).
Extract ONLY the information actually visible in the image as JSON with exactly these keys:
{"name": string|null, "phone": string|null, "website": string|null, "address": string|null, "rating": number|null, "reviewCount": number|null, "category": string|null, "email": string|null}
Rules: never guess or invent; if a field is not visible in the image, use null. If the image shows a UI header instead of a business (e.g. "Details"), do NOT use it as the name. Return ONLY the JSON object, no markdown.`;

const b64 = readFileSync(imagePath).toString("base64");

const started = Date.now();
const res = await fetch(BASE, {
  method: "POST",
  headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json", "Accept": "application/json" },
  signal: AbortSignal.timeout(120_000),
  body: JSON.stringify({
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: PROMPT },
        { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
      ],
    }],
    max_tokens: 1500,
    temperature: 0,
    stream: false,
  }),
});
const ms = Date.now() - started;
console.log(`[${model}] STATUS: ${res.status} (${ms}ms)`);
const text = await res.text();
try {
  const json = JSON.parse(text);
  const msg = json?.choices?.[0]?.message ?? {};
  console.log("USAGE:", JSON.stringify(json?.usage ?? null));
  console.log("CONTENT:", msg.content ?? "(null)");
  if (msg.reasoning_content) console.log("REASONING(first 400):", String(msg.reasoning_content).slice(0, 400));
} catch {
  console.log("BODY:", text.slice(0, 800));
}
