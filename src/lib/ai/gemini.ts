import "server-only";
import { env } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";
import type { LLMProvider, LLMRequest, ProviderErrorKind } from "./types";
import { ProviderError } from "./types";

/**
 * Google Gemini provider (primary).
 *
 * Talks to the raw REST API (generativelanguage.googleapis.com) with the
 * x-goog-api-key header. Works with both legacy "AIza..." keys and the new
 * "AQ...." AI Studio authentication keys — verified against a live key.
 */

const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const GEMINI_TIMEOUT_MS = 30_000;

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

interface GeminiApiErrorPayload {
  error?: { code?: number; message?: string; status?: string };
}

interface GeminiPart {
  text?: string;
  inline_data?: { mime_type?: string; data?: string };
}

interface GeminiResponsePayload {
  candidates?: Array<{
    content?: { parts?: GeminiPart[]; role?: string };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  modelVersion?: string;
}

/** Map an HTTP failure from the Gemini API onto our provider error taxonomy. */
export function classifyGeminiFailure(
  httpStatus: number,
  status: string | undefined,
  message: string
): ProviderErrorKind {
  if (httpStatus === 429 || status === "RESOURCE_EXHAUSTED") {
    // Per-minute rate limits recover fast; a spent quota/billing balance does not.
    return /per minute|per-minute|rate limit|too many requests/i.test(message)
      ? "rate-limit"
      : "quota";
  }
  if (
    httpStatus === 401 ||
    httpStatus === 403 ||
    status === "UNAUTHENTICATED" ||
    status === "PERMISSION_DENIED"
  ) {
    return "auth";
  }
  if (httpStatus === 408 || httpStatus >= 500) return "transient";
  return "bad-request";
}

export class GeminiProvider implements LLMProvider {
  readonly id = "gemini" as const;
  readonly label = "Google Gemini";

  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl?: typeof fetch) {
    this.fetchImpl = fetchImpl ?? fetch;
  }

  get model(): string {
    return env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL;
  }

  isConfigured(): boolean {
    return Boolean(env.GEMINI_API_KEY);
  }

  async complete(req: LLMRequest): Promise<string> {
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new ProviderError(this.id, "auth", "GEMINI_API_KEY is not configured.");
    }

    const parts: GeminiPart[] = [{ text: req.user }];
    for (const image of req.images ?? []) {
      parts.push({ inline_data: { mime_type: image.mimeType, data: image.data } });
    }

    const body: Record<string, unknown> = {
      contents: [{ role: "user", parts }],
      generationConfig: {
        temperature: req.temperature ?? 0.4,
        maxOutputTokens: req.maxOutputTokens,
        ...(req.json ? { responseMimeType: "application/json" } : {}),
        // Strip Gemini 3.x "thinking" by default so the output-token budget is
        // spent on the visible answer, matching non-reasoning OpenAI models.
        thinkingConfig:
          req.thinking === "low" ? { thinkingLevel: "low" } : { thinkingBudget: 0 },
      },
    };
    if (req.system) {
      body.systemInstruction = { parts: [{ text: req.system }] };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    let httpStatus: number;
    let rawBody: string;
    try {
      const res = await this.fetchImpl(`${GEMINI_API_BASE}/models/${this.model}:generateContent`, {
        method: "POST",
        headers: {
          "x-goog-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      httpStatus = res.status;
      rawBody = await res.text();
    } catch (error) {
      throw new ProviderError(
        this.id,
        "transient",
        `Gemini request failed: ${getErrorMessage(error)}`
      );
    } finally {
      clearTimeout(timer);
    }

    let payload: (GeminiResponsePayload & GeminiApiErrorPayload) | null = null;
    try {
      payload = JSON.parse(rawBody) as GeminiResponsePayload & GeminiApiErrorPayload;
    } catch {
      payload = null;
    }

    if (httpStatus < 200 || httpStatus >= 300) {
      const apiError = payload?.error;
      throw new ProviderError(
        this.id,
        classifyGeminiFailure(httpStatus, apiError?.status, apiError?.message ?? rawBody),
        apiError?.message ?? `Gemini API returned HTTP ${httpStatus}.`,
        httpStatus
      );
    }

    const candidate = payload?.candidates?.[0];
    const text = (candidate?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();

    if (text) return text;

    const reason = payload?.promptFeedback?.blockReason ?? candidate?.finishReason;
    if (reason && reason !== "STOP" && reason !== "MAX_TOKENS") {
      throw new ProviderError(
        this.id,
        "blocked",
        `Gemini returned no content (reason: ${reason}).`
      );
    }
    throw new ProviderError(this.id, "empty", "Gemini returned an empty response.");
  }
}
