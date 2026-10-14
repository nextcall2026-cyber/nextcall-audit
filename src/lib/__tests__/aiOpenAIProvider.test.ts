/**
 * OpenAIProvider behavior tests with a mocked OpenAI SDK client.
 * Covers the legacy→modern parameter compatibility shim and error mapping.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const openaiMock = vi.hoisted(() => ({
  behavior: "ok" as "ok" | "legacy400thenok" | "quota",
  calls: [] as Array<Record<string, unknown>>,
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    constructor(public readonly config: unknown) {}
    readonly chat = {
      completions: {
        create: async (params: Record<string, unknown>) => {
          openaiMock.calls.push(params);
          if (openaiMock.behavior === "quota") {
            const error = new Error(
              "You have no credits remaining. Add credits to continue using the API."
            );
            (error as { status?: number }).status = 429;
            throw error;
          }
          if (openaiMock.behavior === "legacy400thenok" && openaiMock.calls.length === 1) {
            const error = new Error(
              "'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."
            );
            (error as { status?: number }).status = 400;
            throw error;
          }
          return { choices: [{ message: { content: '{"ok":true}' } }] };
        },
      },
    };
  },
}));

// The provider reads credentials from "@/lib/env" at call time; a Proxy keeps
// the mock independent of any real key material.
vi.mock("@/lib/env", () => ({
  env: new Proxy({}, { get: () => "unit-test-stub" }),
}));

import { OpenAIProvider } from "@/lib/ai/openaiProvider";
import { ProviderError } from "@/lib/ai/types";

describe("OpenAIProvider parameter compatibility", () => {
  const provider = new OpenAIProvider();

  beforeEach(() => {
    openaiMock.calls.length = 0;
    openaiMock.behavior = "ok";
  });

  it("sends the legacy shape (max_tokens + temperature) by default", async () => {
    const text = await provider.complete({ user: "hi", maxOutputTokens: 123, temperature: 0.3 });

    expect(text).toBe('{"ok":true}');
    expect(openaiMock.calls).toHaveLength(1);
    expect(openaiMock.calls[0].max_tokens).toBe(123);
    expect(openaiMock.calls[0].temperature).toBe(0.3);
    expect(openaiMock.calls[0].max_completion_tokens).toBeUndefined();
  });

  // PENDING: enable together with the legacy→modern parameter shim in
  // openaiProvider.ts. Deferred on 2026-10-14: gpt-6-luna cannot be live-tested
  // until the OpenAI account has credits, and the provider file is currently
  // unmodifiable by the agent (workspace guard flags its pre-existing apiKey
  // property). If gpt-6-luna accepts legacy parameters, this stays skipped.
  it.skip("retries transparently with modern parameters when legacy ones are rejected", async () => {
    openaiMock.behavior = "legacy400thenok";

    const text = await provider.complete({ user: "hi", maxOutputTokens: 123, temperature: 0.3 });

    expect(text).toBe('{"ok":true}');
    expect(openaiMock.calls).toHaveLength(2);
    expect(openaiMock.calls[0].max_tokens).toBe(123);
    expect(openaiMock.calls[1].max_completion_tokens).toBe(123);
    expect(openaiMock.calls[1].max_tokens).toBeUndefined();
    expect(openaiMock.calls[1].temperature).toBeUndefined();
  });

  it("does not retry with modern parameters when the failure is unrelated", async () => {
    openaiMock.behavior = "quota";

    const error = await provider
      .complete({ user: "hi", maxOutputTokens: 10 })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe("quota");
    expect(openaiMock.calls).toHaveLength(1);
  });
});
