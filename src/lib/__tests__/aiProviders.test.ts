/**
 * Provider-level tests: Gemini request mapping against a mocked fetch, and
 * error classification for both providers.
 */
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY ?? "test-gemini-key";
  process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? "test-openai-key";
});

import {
  classifyGeminiFailure,
  DEFAULT_GEMINI_MODEL,
  GeminiProvider,
} from "@/lib/ai/gemini";
import { classifyOpenAIFailure } from "@/lib/ai/openaiProvider";
import { ProviderError, type LLMRequest } from "@/lib/ai/types";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function makeProvider(fetchMock: ReturnType<typeof vi.fn>) {
  return new GeminiProvider(fetchMock as unknown as typeof fetch);
}

const okPayload = {
  candidates: [
    { content: { role: "model", parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" },
  ],
};

describe("GeminiProvider.complete", () => {
  it("maps a full request (system + text + image + json) onto the REST API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, okPayload));
    const provider = makeProvider(fetchMock);

    const request: LLMRequest = {
      system: "You are a test.",
      user: "Hello",
      images: [{ mimeType: "image/png", data: "QUJD" }],
      temperature: 0.2,
      maxOutputTokens: 555,
      json: true,
      thinking: "off",
    };
    const text = await provider.complete(request);

    expect(text).toBe('{"ok":true}');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      `https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_MODEL}:generateContent`
    );
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-gemini-key");
    expect(headers["Content-Type"]).toBe("application/json");

    const body = JSON.parse(String(init.body));
    expect(body.systemInstruction.parts[0].text).toBe("You are a test.");
    expect(body.contents[0].role).toBe("user");
    expect(body.contents[0].parts[0].text).toBe("Hello");
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: "image/png", data: "QUJD" });
    expect(body.generationConfig.temperature).toBe(0.2);
    expect(body.generationConfig.maxOutputTokens).toBe(555);
    expect(body.generationConfig.responseMimeType).toBe("application/json");
    // Thinking is disabled by default so maxOutputTokens is spent on the answer.
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  it("uses a low thinking level when requested", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, okPayload));
    const provider = makeProvider(fetchMock);

    await provider.complete({ user: "x", maxOutputTokens: 100, thinking: "low" });

    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: "low" });
  });

  it("throws a quota error (long cooldown) when the free tier / credits are exhausted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(429, {
        error: {
          code: 429,
          message: "You exceeded your current quota, please check your plan and billing details.",
          status: "RESOURCE_EXHAUSTED",
        },
      })
    );
    const provider = makeProvider(fetchMock);

    const error = await provider.complete({ user: "x", maxOutputTokens: 10 }).catch((e) => e);

    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe("quota");
    expect((error as ProviderError).provider).toBe("gemini");
    expect((error as ProviderError).httpStatus).toBe(429);
  });

  it("throws an auth error for rejected keys", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(401, {
        error: { code: 401, message: "API key not valid.", status: "UNAUTHENTICATED" },
      })
    );

    const error = await makeProvider(fetchMock)
      .complete({ user: "x", maxOutputTokens: 10 })
      .catch((e) => e);

    expect((error as ProviderError).kind).toBe("auth");
  });

  it("classifies 5xx as transient", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(503, { error: { code: 503, message: "Service unavailable", status: "UNAVAILABLE" } })
    );

    const error = await makeProvider(fetchMock)
      .complete({ user: "x", maxOutputTokens: 10 })
      .catch((e) => e);

    expect((error as ProviderError).kind).toBe("transient");
  });

  it("maps a safety block to a blocked error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, { promptFeedback: { blockReason: "SAFETY" }, candidates: [] })
    );

    const error = await makeProvider(fetchMock)
      .complete({ user: "x", maxOutputTokens: 10 })
      .catch((e) => e);

    expect((error as ProviderError).kind).toBe("blocked");
  });

  it("maps an empty candidate list to an empty error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { candidates: [] }));

    const error = await makeProvider(fetchMock)
      .complete({ user: "x", maxOutputTokens: 10 })
      .catch((e) => e);

    expect((error as ProviderError).kind).toBe("empty");
  });

  it("maps network / timeout failures to transient", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("This operation was aborted"));

    const error = await makeProvider(fetchMock)
      .complete({ user: "x", maxOutputTokens: 10 })
      .catch((e) => e);

    expect((error as ProviderError).kind).toBe("transient");
  });
});

describe("classifyGeminiFailure", () => {
  it("distinguishes per-minute rate limits from quota exhaustion", () => {
    expect(
      classifyGeminiFailure(429, "RESOURCE_EXHAUSTED", "Rate limit exceeded. Please retry after 20s.")
    ).toBe("rate-limit");
    expect(
      classifyGeminiFailure(
        429,
        "RESOURCE_EXHAUSTED",
        "You exceeded your current quota, please check your plan and billing details."
      )
    ).toBe("quota");
  });

  it("maps the remaining statuses onto the taxonomy", () => {
    expect(classifyGeminiFailure(403, "PERMISSION_DENIED", "billing disabled")).toBe("auth");
    expect(classifyGeminiFailure(401, "UNAUTHENTICATED", "bad key")).toBe("auth");
    expect(classifyGeminiFailure(503, "UNAVAILABLE", "unavailable")).toBe("transient");
    expect(classifyGeminiFailure(408, undefined, "timeout")).toBe("transient");
    expect(classifyGeminiFailure(400, "INVALID_ARGUMENT", "bad request")).toBe("bad-request");
  });
});

describe("classifyOpenAIFailure", () => {
  it("maps OpenAI errors onto the provider taxonomy", () => {
    expect(
      classifyOpenAIFailure(429, "You exceeded your current quota, please check your plan and billing details.")
    ).toBe("quota");
    expect(classifyOpenAIFailure(429, "Rate limit reached for requests.")).toBe("rate-limit");
    expect(classifyOpenAIFailure(401, "Incorrect API key provided.")).toBe("auth");
    expect(
      classifyOpenAIFailure(503, "The server had an error while processing your request.")
    ).toBe("transient");
    expect(classifyOpenAIFailure(400, "Invalid request.")).toBe("bad-request");
    expect(classifyOpenAIFailure(undefined, "socket hang up")).toBe("bad-request");
  });
});
