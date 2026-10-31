import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("server-only", () => ({}));

import { OpenAICompatibleProvider } from "@/lib/ai/openaiCompatible";
import { ProviderError } from "@/lib/ai/types";

const ENV_KEYS = ["FREE1_BASE_URL", "FREE1_ACCESS", "FREE1_MODEL"] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.FREE1_BASE_URL = "https://api.groq.com/openai/v1";
  process.env.FREE1_ACCESS = "test-access";
  process.env.FREE1_MODEL = "llama-test";
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("OpenAICompatibleProvider (free fallback slot)", () => {
  it("is configured only when all three env values are present", () => {
    expect(new OpenAICompatibleProvider(1).isConfigured()).toBe(true);
    delete process.env.FREE1_MODEL;
    expect(new OpenAICompatibleProvider(1).isConfigured()).toBe(false);
  });

  it("posts a chat completion and returns the text", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "hello" } }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    const provider = new OpenAICompatibleProvider(1);
    await expect(provider.complete({ user: "hi", maxOutputTokens: 100 })).resolves.toBe("hello");

    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.groq.com/openai/v1/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("llama-test");
  });

  it("sends images as data URLs (vision requests)", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    await new OpenAICompatibleProvider(1).complete({
      user: "read the screenshot",
      images: [{ mimeType: "image/png", data: "abc" }],
      maxOutputTokens: 50,
    });
    const body = JSON.parse(String((mockFetch.mock.calls[0] as [string, RequestInit])[1].body));
    expect(JSON.stringify(body.messages)).toContain("data:image/png;base64,abc");
  });

  it("uses the chain name from the request instead of the slot's default model", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    await new OpenAICompatibleProvider(1).complete({
      user: "write the report",
      maxOutputTokens: 100,
      model: "auto:report-main",
    });

    const body = JSON.parse(String((mockFetch.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.model).toBe("auto:report-main");
  });

  it("falls back to the slot's model when no chain is given", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    await new OpenAICompatibleProvider(1).complete({ user: "hi", maxOutputTokens: 10 });

    const body = JSON.parse(String((mockFetch.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.model).toBe("llama-test");
  });

  it("classifies auth errors so the breaker parks the slot", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unauthorized", { status: 401 })));
    const err = await new OpenAICompatibleProvider(1)
      .complete({ user: "hi", maxOutputTokens: 10 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect((err as ProviderError).kind).toBe("auth");
  });

  it("classifies rate-limit errors", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("slow down", { status: 429 })));
    const err = await new OpenAICompatibleProvider(1)
      .complete({ user: "hi", maxOutputTokens: 10 })
      .catch((e: unknown) => e);
    expect((err as ProviderError).kind).toBe("rate-limit");
  });

  it("throws empty-response errors when the provider returns no content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [] }), { status: 200 }))
    );
    const err = await new OpenAICompatibleProvider(1)
      .complete({ user: "hi", maxOutputTokens: 10 })
      .catch((e: unknown) => e);
    expect((err as ProviderError).kind).toBe("empty");
  });
});
