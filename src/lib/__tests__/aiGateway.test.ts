/**
 * Gateway routing tests: provider order, failover, and circuit-breaker
 * behavior. The concrete providers are mocked at the module boundary —
 * provider-level behavior is covered in aiProviders.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mutable test state shared with the mocked provider classes below.
const providerMocks = vi.hoisted(() => ({
  geminiConfigured: true,
  openaiConfigured: true,
  geminiComplete: vi.fn(),
  openaiComplete: vi.fn(),
}));

vi.mock("@/lib/ai/gemini", () => ({
  DEFAULT_GEMINI_MODEL: "gemini-test",
  GeminiProvider: class {
    readonly id = "gemini" as const;
    readonly label = "Google Gemini";
    get model(): string {
      return "gemini-test";
    }
    isConfigured(): boolean {
      return providerMocks.geminiConfigured;
    }
    complete(request: unknown) {
      return providerMocks.geminiComplete(request);
    }
  },
  classifyGeminiFailure: vi.fn(),
}));

vi.mock("@/lib/ai/openaiProvider", () => ({
  DEFAULT_OPENAI_MODEL: "gpt-test",
  OpenAIProvider: class {
    readonly id = "openai" as const;
    readonly label = "OpenAI";
    get model(): string {
      return "gpt-test";
    }
    isConfigured(): boolean {
      return providerMocks.openaiConfigured;
    }
    complete(request: unknown) {
      return providerMocks.openaiComplete(request);
    }
  },
  classifyOpenAIFailure: vi.fn(),
}));

import { breaker } from "@/lib/ai/breaker";
import {
  generateLLMResponse,
  getLLMStatus,
  LLMUnavailableError,
  ProviderError,
  type LLMRequest,
} from "@/lib/ai";

const baseRequest: LLMRequest = { user: "hello", maxOutputTokens: 100 };

describe("LLM gateway routing", () => {
  beforeEach(() => {
    breaker.reset();
    providerMocks.geminiConfigured = true;
    providerMocks.openaiConfigured = true;
    providerMocks.geminiComplete.mockReset();
    providerMocks.openaiComplete.mockReset();
  });

  it("serves from the primary provider (Gemini) when it succeeds", async () => {
    providerMocks.geminiComplete.mockResolvedValueOnce('{"ok":true}');

    const result = await generateLLMResponse(baseRequest);

    expect(result).toEqual({
      text: '{"ok":true}',
      provider: "gemini",
      model: "gemini-test",
      fallback: false,
    });
    expect(providerMocks.openaiComplete).not.toHaveBeenCalled();
  });

  it("activates the OpenAI fallback when Gemini fails", async () => {
    providerMocks.geminiComplete.mockRejectedValueOnce(
      new ProviderError("gemini", "quota", "Quota exceeded.")
    );
    providerMocks.openaiComplete.mockResolvedValueOnce('{"ok":true}');

    const result = await generateLLMResponse(baseRequest);

    expect(result.provider).toBe("openai");
    expect(result.fallback).toBe(true);
    expect(result.text).toBe('{"ok":true}');
  });

  it("skips Gemini while its circuit breaker is open after a quota failure", async () => {
    providerMocks.geminiComplete.mockRejectedValueOnce(
      new ProviderError("gemini", "quota", "out of credit")
    );
    providerMocks.openaiComplete.mockResolvedValue("fallback-text");

    await generateLLMResponse(baseRequest);
    const second = await generateLLMResponse(baseRequest);

    expect(second.provider).toBe("openai");
    expect(second.fallback).toBe(true);
    // Second call went straight to OpenAI — Gemini was skipped by the breaker.
    expect(providerMocks.geminiComplete).toHaveBeenCalledTimes(1);
  });

  it("keeps trying the primary after zero-cooldown failures (bad request)", async () => {
    providerMocks.geminiComplete.mockRejectedValue(
      new ProviderError("gemini", "bad-request", "invalid argument")
    );
    providerMocks.openaiComplete.mockResolvedValue("fallback-text");

    await generateLLMResponse(baseRequest);
    await generateLLMResponse(baseRequest);

    expect(providerMocks.geminiComplete).toHaveBeenCalledTimes(2);
  });

  it("throws LLMUnavailableError when every provider fails", async () => {
    providerMocks.geminiComplete.mockRejectedValue(
      new ProviderError("gemini", "transient", "gemini down")
    );
    providerMocks.openaiComplete.mockRejectedValue(
      new ProviderError("openai", "transient", "openai down")
    );

    const error = await generateLLMResponse(baseRequest).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(LLMUnavailableError);
    expect((error as Error).message).toMatch(/gemini down/);
    expect((error as Error).message).toMatch(/openai down/);
  });

  it("reports provider health including open circuits", async () => {
    providerMocks.geminiComplete.mockRejectedValueOnce(
      new ProviderError("gemini", "auth", "bad key")
    );
    providerMocks.openaiComplete.mockResolvedValueOnce("ok");

    await generateLLMResponse(baseRequest);

    const status = getLLMStatus();
    const gemini = status.find((s) => s.id === "gemini");
    const openai = status.find((s) => s.id === "openai");

    expect(gemini?.role).toBe("primary");
    expect(gemini?.configured).toBe(true);
    expect(gemini?.model).toBe("gemini-test");
    expect(gemini?.circuit).toBe("open");
    expect(gemini?.lastErrorKind).toBe("auth");
    expect(openai?.role).toBe("fallback");
    expect(openai?.configured).toBe(true);
    expect(openai?.circuit).toBe("closed");
  });

  it("throws a configuration error when no provider is configured", async () => {
    try {
      providerMocks.geminiConfigured = false;
      providerMocks.openaiConfigured = false;
      vi.resetModules();
      const fresh = await import("@/lib/ai");

      await expect(fresh.generateLLMResponse(baseRequest)).rejects.toThrow(
        /No LLM provider is configured/
      );
    } finally {
      providerMocks.geminiConfigured = true;
      providerMocks.openaiConfigured = true;
      vi.resetModules();
    }
  });
});
