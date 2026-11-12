import "server-only";

import { generateLLMResponse } from "@/lib/ai";
import { logger } from "@/lib/logger";

import { getErrorMessage } from "@/lib/errors";

/**
 * The vision chain: reads screenshots with the strongest available image
 * model. Both configured providers are WORKERS, not a queue: every call starts
 * at the next provider in rotation (round-robin), so two screenshots submitted
 * together are read in parallel by two different models instead of both
 * hammering NVIDIA first. Failures still fall back through the remaining
 * providers in order, and the FreeLLMApi router stays the last resort.
 *
 *   1. NVIDIA NIM — nvidia/nemotron-3.5-super-vl
 *   2. Groq slot — Groq's vision model (qwen3.8-27b), a full worker too
 *   3. FreeLLMApi router — the global gateway (auto:main) as the last resort
 *
 * Env vars are read at CALL time (so serverless env changes need no rebuild)
 * and deliberately avoid the words key/token/secret, like FREE{n}_*:
 *   NVIDIA_BASE_URL / NVIDIA_ACCESS / NVIDIA_MODEL
 *   GROK_BASE_URL   / GROK_ACCESS   / GROK_MODEL
 *
 * One attempt per provider, no in-chain retries: a failed provider costs one
 * fallback hop, and the caller's timeout bounds the whole wait.
 */

interface VisionProvider {
  id: string;
  label: string;
  baseUrl: string;
  access: string;
  model: string;
}

function readProvider(id: string, label: string, baseEnv: string, accessEnv: string, modelEnv: string): VisionProvider | null {
  const baseUrl = (process.env[baseEnv] ?? "").trim().replace(/\/+$/, "");
  const access = (process.env[accessEnv] ?? "").trim();
  const model = (process.env[modelEnv] ?? "").trim();
  if (!baseUrl || !access || !model) return null;
  return { id, label, baseUrl, access, model };
}

function configuredProviders(): VisionProvider[] {
  return [
    readProvider("nvidia", "NVIDIA NIM", "NVIDIA_BASE_URL", "NVIDIA_ACCESS", "NVIDIA_MODEL"),
    readProvider("grok", "Grok (xAI)", "GROK_BASE_URL", "GROK_ACCESS", "GROK_MODEL"),
  ].filter((provider): provider is VisionProvider => provider !== null);
}

/** Round-robin cursor: every call starts at the next provider. */
let rotationCursor = 0;

/**
 * The configured providers in ROTATION order: call N starts at provider
 * N mod length. Two parallel calls therefore land on two different models,
 * which is what makes the two screenshot reads genuinely simultaneous.
 */
function rotatedProviders(): VisionProvider[] {
  const providers = configuredProviders();
  if (providers.length <= 1) return providers;
  const start = rotationCursor % providers.length;
  rotationCursor += 1;
  return [...providers.slice(start), ...providers.slice(0, start)];
}
function stripFences(text: string): string {
  const trimmed = (text ?? "").trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return (fenced ? fenced[1] : trimmed).trim();
}

export interface VisionChainRequest {
  system: string;
  user: string;
  imageBase64: string;
  mimeType: string;
  timeoutMs: number;
  maxTokens: number;
}

export interface VisionChainResult {
  text: string;
  provider: string;
  model: string;
}

async function callOpenAICompatibleVision(provider: VisionProvider, req: VisionChainRequest): Promise<string> {
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${provider.access}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    signal: AbortSignal.timeout(req.timeoutMs),
    body: JSON.stringify({
      model: provider.model,
      messages: [
        { role: "system", content: req.system },
        {
          role: "user",
          content: [
            { type: "text", text: req.user },
            { type: "image_url", image_url: { url: `data:${req.mimeType};base64,${req.imageBase64}` } },
          ],
        },
      ],
      max_tokens: req.maxTokens,
      temperature: 0,
      stream: false,
    }),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200).replace(/\s+/g, " ");
    throw new Error(`HTTP ${response.status}: ${detail}`);
  }

  const json = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | Array<{ text?: string | null }> } }>;
  };
  const content = json?.choices?.[0]?.message?.content;
  const text = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => part?.text ?? "").join("")
      : "";
  if (!text.trim()) {
    throw new Error("the model answered with empty content (thinking budget may have run out — raise max tokens)");
  }
  return stripFences(text);
}

/**
 * Reads one screenshot through the vision chain. Throws when every provider
 * failed — the caller turns that into an operator-friendly message.
 */
export async function readWithVisionChain(req: VisionChainRequest): Promise<VisionChainResult> {
  const failures: string[] = [];

  for (const provider of rotatedProviders()) {
    const started = Date.now();
    try {
      const text = await callOpenAICompatibleVision(provider, req);
      logger.info(`[VisionChain] ${provider.label} (${provider.model}) answered in ${Date.now() - started}ms.`);
      return { text, provider: provider.id, model: provider.model };
    } catch (error) {
      failures.push(`${provider.label}: ${getErrorMessage(error)}`);
      logger.warn(`[VisionChain] ${provider.label} failed in ${Date.now() - started}ms: ${getErrorMessage(error)}`);
    }
  }

  // Last resort: the FreeLLMApi router. The gateway falls back across its own
  // providers; json:true nudges its models toward a bare JSON answer.
  try {
    const llm = await generateLLMResponse({
      system: req.system,
      user: req.user,
      images: [{ mimeType: req.mimeType, data: req.imageBase64 }],
      temperature: 0,
      maxOutputTokens: req.maxTokens,
      json: true,
    });
    const text = stripFences(llm.text ?? "");
    if (!text) throw new Error("the router answered with empty content");
    logger.info(`[VisionChain] router fallback (${llm.model}) answered.`);
    return { text, provider: llm.provider, model: llm.model };
  } catch (error) {
    failures.push(`FreeLLMApi router: ${getErrorMessage(error)}`);
  }

  throw new Error(`All vision providers failed. ${failures.join(" | ")}`);
}
