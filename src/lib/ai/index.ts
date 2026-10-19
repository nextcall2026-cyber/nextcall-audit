import "server-only";
import { logger } from "@/lib/logger";
import { breaker } from "./breaker";
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openaiProvider";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import { LLMProvider, LLMRequest, LLMResponse, LLMUnavailableError, ProviderError, ProviderErrorKind, ProviderId } from "./types";

/**
 * LLM gateway — the single entry point every AI feature in this app uses.
 *
 * Routing policy:
 *   1. xAI Grok keys are tried FIRST (FREE1_* / FREE2_* / FREE3_* env vars —
 *      one slot per key). When a key hits its limit, the circuit breaker parks
 *      it and the next key takes over automatically.
 *   2. Google Gemini (free tier) is the late fallback — its shared capacity
 *      produces intermittent 503s, so it no longer leads the chain.
 *   3. Paid OpenAI is the LAST resort, activated automatically whenever
 *      everything before it fails.
 *   4. A per-provider circuit breaker parks a persistently failing provider
 *      (10 min for quota/auth, 60 s for transient errors) so requests don't
 *      pay the failed provider's latency until it likely recovered.
 *
 * Call sites never see vendor SDKs; they call `generateLLMResponse()` and get
 * back `{ text, provider, model, fallback }`. The settings page can surface
 * provider health via `getLLMStatus()`.
 *
 * To add or reorder providers, edit buildProviderChain() below.
 */

export * from "./types";

function buildProviderChain(): LLMProvider[] {
  const chain: LLMProvider[] = [];
  // 1) xAI Grok keys first (FREE1_* / FREE2_* / FREE3_* — one slot per key).
  //    When a key hits its limit the circuit breaker parks it and the next
  //    slot takes over automatically.
  for (const slot of [1, 2, 3, 4, 5] as const) {
    const free = new OpenAICompatibleProvider(slot);
    if (free.isConfigured()) chain.push(free);
  }
  // 2) Google Gemini — free but capacity-limited (intermittent 503s).
  const gemini = new GeminiProvider();
  if (gemini.isConfigured()) chain.push(gemini);
  // 3) Last resort — paid OpenAI (automatic fallback)
  const openai = new OpenAIProvider();
  if (openai.isConfigured()) chain.push(openai);
  return chain;
}

const providerChain = buildProviderChain();

const PROVIDER_DESCRIPTORS: Array<{ id: ProviderId; label: string }> = [
  ...([1, 2, 3, 4, 5] as const)
    .map((slot) => new OpenAICompatibleProvider(slot))
    .filter((provider) => provider.isConfigured())
    .map((provider) => ({ id: provider.id, label: provider.label })),
  { id: "gemini", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
];

/** Transient spikes (e.g. "high demand" 503s) usually clear within seconds —
 * give the provider one quick second chance before falling back. */
const TRANSIENT_RETRY_DELAY_MS = 2000;
const RETRYABLE_KINDS: ReadonlySet<ProviderErrorKind> = new Set(["transient", "rate-limit"]);

async function attemptWithTransientRetry(provider: LLMProvider, req: LLMRequest): Promise<string> {
  try {
    return await provider.complete(req);
  } catch (error) {
    const firstError =
      error instanceof ProviderError
        ? error
        : new ProviderError(
            provider.id,
            "transient",
            error instanceof Error ? error.message : String(error)
          );

    if (!RETRYABLE_KINDS.has(firstError.kind)) throw firstError;

    logger.warn(
      `[LLMGateway] ${provider.label} transient ${firstError.kind} failure — retrying once in ${TRANSIENT_RETRY_DELAY_MS}ms: ${firstError.message}`
    );
    await new Promise((resolve) => setTimeout(resolve, TRANSIENT_RETRY_DELAY_MS));

    try {
      return await provider.complete(req);
    } catch (retryError) {
      throw retryError instanceof ProviderError
        ? retryError
        : new ProviderError(
            provider.id,
            "transient",
            retryError instanceof Error ? retryError.message : String(retryError)
          );
    }
  }
}

export async function generateLLMResponse(req: LLMRequest): Promise<LLMResponse> {
  if (providerChain.length === 0) {
    throw new LLMUnavailableError(
      "No LLM provider is configured. Set FREE1_BASE_URL + FREE1_ACCESS + FREE1_MODEL (any OpenAI-compatible vendor, e.g. xAI Grok at https://api.x.ai/v1), GEMINI_API_KEY and/or OPENAI_API_KEY in environment variables."
    );
  }

  const failures: string[] = [];

  for (let index = 0; index < providerChain.length; index++) {
    const provider = providerChain[index];

    if (!breaker.canAttempt(provider.id)) {
      const remainingSec = Math.round(breaker.cooldownRemainingMs(provider.id) / 1000);
      failures.push(`${provider.label}: skipped (cooling down for ~${remainingSec}s after a previous failure)`);
      continue;
    }

    try {
      const text = await attemptWithTransientRetry(provider, req);
      breaker.recordSuccess(provider.id);
      if (index > 0) {
        logger.warn(
          `[LLMGateway] Request served by FALLBACK ${provider.label} (${provider.model}); primary ${providerChain[0].label} was unavailable.`
        );
      }
      return { text, provider: provider.id, model: provider.model, fallback: index > 0 };
    } catch (error) {
      const providerError =
        error instanceof ProviderError
          ? error
          : new ProviderError(
              provider.id,
              "transient",
              error instanceof Error ? error.message : String(error)
            );
      breaker.recordFailure(provider.id, providerError.kind, providerError.message);
      logger.warn(
        `[LLMGateway] ${provider.label} (${provider.model}) failed [${providerError.kind}]: ${providerError.message}`
      );
      failures.push(`${provider.label}: ${providerError.message}`);
    }
  }

  throw new LLMUnavailableError(`All LLM providers failed. ${failures.join(" | ")}`);
}

export interface LLMProviderStatus {
  id: ProviderId;
  label: string;
  role: "primary" | "fallback";
  configured: boolean;
  model: string | null;
  circuit: "closed" | "open";
  cooldownRemainingMs: number;
  lastErrorKind: string | null;
  lastErrorMessage: string | null;
}

/** Health snapshot for the settings page / monitoring. */
export function getLLMStatus(): LLMProviderStatus[] {
  return PROVIDER_DESCRIPTORS.map((descriptor) => {
    const active = providerChain.find((provider) => provider.id === descriptor.id);
    const position = providerChain.findIndex((provider) => provider.id === descriptor.id);
    const snap = breaker.snapshot(descriptor.id);
    return {
      id: descriptor.id,
      label: descriptor.label,
      role: position === 0 ? "primary" : "fallback",
      configured: Boolean(active),
      model: active?.model ?? null,
      circuit: snap.isOpen ? "open" : "closed",
      cooldownRemainingMs: snap.cooldownRemainingMs,
      lastErrorKind: snap.lastErrorKind,
      lastErrorMessage: snap.lastErrorMessage,
    };
  });
}
