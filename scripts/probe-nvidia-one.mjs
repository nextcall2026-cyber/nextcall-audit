/** One-off: raw request/response dump for a single NVIDIA model. */
import { readFileSync } from "node:fs";

const KEY = process.env.UNOROUTER_KEY;
const BASE = process.env.PROBE_BASE_URL ?? "https://integrate.api.nvidia.com/v1/chat/completions";
const model = process.argv[2];
const timeoutMs = Number(process.env.TIMEOUT_MS ?? 90_000);

const b64 = readFileSync(new URL("../.zwork/tmp/vision-test.png", import.meta.url)).toString("base64");

const started = Date.now();
const res = await fetch(BASE, {
  method: "POST",
  headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json", "Accept": "application/json" },
  signal: AbortSignal.timeout(timeoutMs),
  body: JSON.stringify({
    model,
    messages: [{
      role: "user",
      content: [
        { type: "text", text: "Reply with exactly the uppercase text visible in the image, nothing else." },
        { type: "image_url", image_url: { url: `data:image/png;base64,${b64}` } },
      ],
    }],
    max_tokens: 200,
    temperature: 0,
    stream: false,
  }),
});
const ms = Date.now() - started;
console.log("STATUS:", res.status, `${ms}ms`);
for (const [k, v] of res.headers) if (/ratelimit|rate-limit|request|credit/i.test(k)) console.log(`HDR ${k}: ${v}`);
const text = await res.text();
console.log("BODY:", text.slice(0, 1500));
