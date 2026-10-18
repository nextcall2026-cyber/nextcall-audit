/**
 * Shared types for the LLM gateway (see ./index.ts).
 *
 * The gateway abstracts over concrete LLM vendors so call sites never talk to
 * a specific SDK. Today: Google Gemini (primary) with OpenAI as automatic
 * fallback. Tomorrow: add another class implementing LLMProvider.
 */

export type ProviderId = "gemini" | "openai" | "free1" | "free2" | "free3";

/** An image attached to the request. `data` is raw base64 (no data: prefix). */
export interface LLMImageInput {
  mimeType: string;
  data: string;
}

/**
 * Why a provider turned a request off. Drives the circuit-breaker cooldown:
 * - quota / auth        → the provider will stay broken for a while (no credit, bad key)
 * - rate-limit/transient→ likely to recover within seconds/minutes
 * - blocked/bad-request/empty → request-specific, do NOT park the provider
 */
export type ProviderErrorKind =
  | "quota"
  | "auth"
  | "rate-limit"
  | "transient"
  | "blocked"
  | "bad-request"
  | "empty";

export class ProviderError extends Error {
  constructor(
    public readonly provider: ProviderId,
    public readonly kind: ProviderErrorKind,
    message: string,
    public readonly httpStatus?: number
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

/** Thrown when every provider in the chain failed (or none is configured). */
export class LLMUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMUnavailableError";
  }
}

export type ThinkingLevel = "off" | "low";

export interface LLMRequest {
  /** System prompt (mapped to systemInstruction / system message). */
  system?: string;
  /** User prompt text. */
  user: string;
  /** Optional inline images (vision requests). */
  images?: LLMImageInput[];
  temperature?: number;
  maxOutputTokens: number;
  /** Ask for strict JSON output (responseMimeType / response_format). */
  json?: boolean;
  /**
   * Gemini 3.x "thinks" by default, which burns output tokens before any
   * visible text. "off" (default) matches non-reasoning OpenAI models;
   * "low" keeps a small reasoning budget for higher-stakes prose.
   */
  thinking?: ThinkingLevel;
}

export interface LLMResponse {
  text: string;
  provider: ProviderId;
  model: string;
  /** true when the primary provider failed and a later provider served the request. */
  fallback: boolean;
}

export interface LLMProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly model: string;
  isConfigured(): boolean;
  complete(req: LLMRequest): Promise<string>;
}
