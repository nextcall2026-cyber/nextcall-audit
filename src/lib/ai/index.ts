import "server-only";
import { logger } from "@/lib/logger";
import { breaker } from "./breaker";
import { GeminiProvider } from "./gemini";
import { OpenAIProvider } from "./openaiProvider";
import { LLMProvider, LLMRequest, LLMResponse, LLMUnavailableError, ProviderError, ProviderId } from "./types";

/**
 * LLM gateway — the single entry point every AI feature in this app uses.
 *
 * Routing policy:
 *   1. Google Gemini is the PRIMARY provider (preferred budget).
 *   2. OpenAI is the SECONDARY provider, activated automatically whenever the
 *      primary fails for any reason — including running out of credit/quota.
 *   3. A per-provider circuit breaker parks a persistently failing provider
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
  // 1) Primary — Google Gemini
  const gemini = new GeminiProvider();
  if (gemini.isConfigured()) chain.push(gemini);
  // 2) Secondary — OpenAI (automatic fallback)
  const openai = new OpenAIProvider();
  if (openai.isConfigured()) chain.push(openai);
  return chain;
}

const providerChain = buildProviderChain();

const PROVIDER_DESCRIPTORS: Array<{ id: ProviderId; label: string; role: "primary" | "fallback" }> = [
  { id: "gemini", label: "Google Gemini", role: "primary" },
  { id: "openai", label: "OpenAI", role: "fallback" },
];

export async function generateLLMResponse(req: LLMRequest): Promise<LLMResponse> {
  if (providerChain.length === 0) {
    throw new LLMUnavailableError(
      "No LLM provider is configured. Set GEMINI_API_KEY (primary) and/or OPENAI_API_KEY (fallback) in environment variables."
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
      const text = await provider.complete(req);
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
    const snap = breaker.snapshot(descriptor.id);
    return {
      id: descriptor.id,
      label: descriptor.label,
      role: descriptor.role,
      configured: Boolean(active),
      model: active?.model ?? null,
      circuit: snap.isOpen ? "open" : "closed",
      cooldownRemainingMs: snap.cooldownRemainingMs,
      lastErrorKind: snap.lastErrorKind,
      lastErrorMessage: snap.lastErrorMessage,
    };
  });
}
