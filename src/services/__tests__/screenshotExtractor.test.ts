import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AI_CHAINS } from "@/lib/ai/chains";
import {
  cleanValue,
  extractFromScreenshot,
  ScreenshotError,
} from "@/services/screenshotExtractor";

const mocks = vi.hoisted(() => ({
  generateLLMResponse: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({
  generateLLMResponse: mocks.generateLLMResponse,
}));

function reply(fields: Record<string, unknown>) {
  return {
    text: JSON.stringify(fields),
    provider: "free1",
    model: "test",
    fallback: false,
  };
}

function screenshot(): File {
  return new File(["fake-png-bytes"], "shot.png", { type: "image/png" });
}

beforeEach(() => {
  mocks.generateLLMResponse.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("extractFromScreenshot", () => {
  it("reads the business details through the single main chain", async () => {
    mocks.generateLLMResponse.mockResolvedValue(reply({ name: "Acme" }));

    const result = await extractFromScreenshot("google", screenshot(), { timeoutMs: 5_000 });

    expect(result.name).toBe("Acme");
    expect(mocks.generateLLMResponse).toHaveBeenCalledTimes(1);
    expect(mocks.generateLLMResponse.mock.calls[0][0].model).toBe(AI_CHAINS.main);
  });

  it("accepts raw bytes stored by the ingest (worker path)", async () => {
    mocks.generateLLMResponse.mockResolvedValue(reply({ name: "From stored bytes", email: "hi@acme.com" }));

    const result = await extractFromScreenshot(
      "facebook",
      { bytes: Buffer.from("fake-jpeg-bytes"), mimeType: "image/jpeg" },
      { timeoutMs: 5_000 }
    );

    expect(result.email).toBe("hi@acme.com");
    const call = mocks.generateLLMResponse.mock.calls[0][0];
    expect(call.images[0].mimeType).toBe("image/jpeg");
  });

  it("waits out a rate limit and retries the same chain", async () => {
    vi.useFakeTimers();

    mocks.generateLLMResponse
      .mockRejectedValueOnce(new Error("429 Too Many Requests — All models exhausted. Soonest reset ~2s."))
      .mockResolvedValueOnce(reply({ name: "Acme" }));

    const pending = extractFromScreenshot("google", screenshot(), { timeoutMs: 30_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(result.name).toBe("Acme");
    expect(mocks.generateLLMResponse).toHaveBeenCalledTimes(2);
  });

  it("throws the friendly message when every attempt is rate limited", async () => {
    vi.useFakeTimers();

    mocks.generateLLMResponse.mockRejectedValue(
      new Error("429 Too Many Requests — All models exhausted. Soonest reset ~2s.")
    );

    const pending = extractFromScreenshot("google", screenshot(), { timeoutMs: 30_000 });
    const assertion = expect(pending).rejects.toThrow(ScreenshotError);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    expect(mocks.generateLLMResponse).toHaveBeenCalledTimes(3);
  });

  it("rejects a non-image upload before any AI call", async () => {
    await expect(
      extractFromScreenshot("google", new File(["x"], "doc.pdf", { type: "application/pdf" }), {
        timeoutMs: 5_000,
      })
    ).rejects.toThrow(/not an image/i);

    expect(mocks.generateLLMResponse).not.toHaveBeenCalled();
  });
});

describe("cleanValue", () => {
  it("trims and blanks out empty values", () => {
    expect(cleanValue("  Acme  ")).toBe("Acme");
    expect(cleanValue("   ")).toBeNull();
    expect(cleanValue(null)).toBeNull();
    expect(cleanValue(undefined)).toBeNull();
  });
});
