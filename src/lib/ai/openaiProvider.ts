import "server-only";
import OpenAI from "openai";
import { env } from "@/lib/env";
import { getErrorMessage } from "@/lib/errors";
import type { LLMProvider, LLMRequest, ProviderErrorKind } from "./types";
import { ProviderError } from "./types";

/**
 * OpenAI provider (automatic fallback).
 *
 * Uses the official SDK with a lazy singleton client. Roughly mirrors the
 * original src/lib/ai.ts factory (30s timeout, 1 retry) so behavior only
 * changes in *routing*, not in how OpenAI itself is called.
 */

const OPENAI_TIMEOUT_MS = 30_000;

export const DEFAULT_OPENAI_MODEL = "gpt-4o-mini";

/** Map an SDK error onto our provider error taxonomy. */
export function classifyOpenAIFailure(
  status: number | undefined,
  message: string
): ProviderErrorKind {
  if (status === 429) {
    return /quota|billing|credit|insufficient/i.test(message) ? "quota" : "rate-limit";
  }
  if (status === 401 || status === 403) return "auth";
  if (status === 408 || (status !== undefined && status >= 500)) return "transient";
  return "bad-request";
}

export class OpenAIProvider implements LLMProvider {
  readonly id = "openai" as const;
  readonly label = "OpenAI";

  private client: OpenAI | null = null;

  /** fetchImpl is injectable for tests; production uses the SDK default. */
  constructor(fetchImpl?: typeof fetch) {
    if (fetchImpl) {
      this.client = new OpenAI({
        apiKey: env.OPENAI_API_KEY ?? "unused-in-tests",
        timeout: OPENAI_TIMEOUT_MS,
        maxRetries: 1,
        fetch: fetchImpl,
      });
    }
  }

  get model(): string {
    return env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  }

  isConfigured(): boolean {
    return Boolean(env.OPENAI_API_KEY);
  }

  private getClient(): OpenAI {
    if (!env.OPENAI_API_KEY) {
      throw new ProviderError(this.id, "auth", "OPENAI_API_KEY is not configured.");
    }
    if (!this.client) {
      this.client = new OpenAI({
        apiKey: env.OPENAI_API_KEY,
        timeout: OPENAI_TIMEOUT_MS,
        maxRetries: 1,
      });
    }
    return this.client;
  }

  async complete(req: LLMRequest): Promise<string> {
    const userContent: OpenAI.Chat.Completions.ChatCompletionContentPart[] | string =
      req.images && req.images.length > 0
        ? [
            { type: "text", text: req.user },
            ...req.images.map((image) => ({
              type: "image_url" as const,
              image_url: { url: `data:${image.mimeType};base64,${image.data}` },
            })),
          ]
        : req.user;

    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...(req.system ? [{ role: "system" as const, content: req.system }] : []),
      { role: "user", content: userContent },
    ];

    try {
      const response = await this.getClient().chat.completions.create({
        model: this.model,
        temperature: req.temperature ?? 0.4,
        max_tokens: req.maxOutputTokens,
        ...(req.json ? { response_format: { type: "json_object" as const } } : {}),
        messages,
      });

      const text = response.choices[0]?.message?.content?.trim();
      if (text) return text;
      throw new ProviderError(this.id, "empty", "OpenAI returned an empty response.");
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      const status = (error as { status?: number })?.status;
      throw new ProviderError(
        this.id,
        classifyOpenAIFailure(status, getErrorMessage(error)),
        getErrorMessage(error),
        status
      );
    }
  }
}
