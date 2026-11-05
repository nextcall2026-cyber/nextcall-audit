import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanValue,
  extractFromScreenshot,
  ScreenshotError,
} from "@/services/screenshotExtractor";

const mocks = vi.hoisted(() => ({
  readWithVisionChain: vi.fn(),
}));

vi.mock("@/lib/ai/visionChain", () => ({
  readWithVisionChain: mocks.readWithVisionChain,
}));

function reply(fields: Record<string, unknown>) {
  return {
    text: JSON.stringify(fields),
    provider: "nvidia",
    model: "test-vision",
  };
}

function screenshot(): File {
  return new File(["fake-png-bytes"], "shot.png", { type: "image/png" });
}

beforeEach(() => {
  mocks.readWithVisionChain.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("extractFromScreenshot", () => {
  it("reads the business details through the vision chain", async () => {
    mocks.readWithVisionChain.mockResolvedValue(reply({ name: "Acme" }));

    const result = await extractFromScreenshot("google", screenshot(), { timeoutMs: 5_000 });

    expect(result.fields.name).toBe("Acme");
    expect(result.engine).toBe("nvidia");
    expect(mocks.readWithVisionChain).toHaveBeenCalledTimes(1);
    const call = mocks.readWithVisionChain.mock.calls[0][0];
    expect(call.imageBase64).toBeTruthy();
    expect(call.mimeType).toBe("image/png");
  });

  it("accepts raw bytes stored by the ingest (worker path)", async () => {
    mocks.readWithVisionChain.mockResolvedValue(
      reply({ name: "From stored bytes", email: "hi@acme.com" })
    );

    const result = await extractFromScreenshot(
      "facebook",
      { bytes: Buffer.from("fake-jpeg-bytes"), mimeType: "image/jpeg" },
      { timeoutMs: 5_000 }
    );

    expect(result.fields.email).toBe("hi@acme.com");
    const call = mocks.readWithVisionChain.mock.calls[0][0];
    expect(call.mimeType).toBe("image/jpeg");
  });

  it("strips markdown fences around the JSON answer", async () => {
    mocks.readWithVisionChain.mockResolvedValue({
      text: '```json\n{"name":"Fenced Co"}\n```',
      provider: "nvidia",
      model: "test-vision",
    });

    const result = await extractFromScreenshot("google", screenshot(), { timeoutMs: 5_000 });
    expect(result.fields.name).toBe("Fenced Co");
  });

  it("waits out a rate limit and retries the same chain", async () => {
    vi.useFakeTimers();

    mocks.readWithVisionChain
      .mockRejectedValueOnce(new Error("429 Too Many Requests — All models exhausted. Soonest reset ~2s."))
      .mockResolvedValueOnce(reply({ name: "Acme" }));

    const pending = extractFromScreenshot("google", screenshot(), { timeoutMs: 30_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(result.fields.name).toBe("Acme");
    expect(mocks.readWithVisionChain).toHaveBeenCalledTimes(2);
  });

  it("throws the friendly message when every attempt is rate limited", async () => {
    vi.useFakeTimers();

    mocks.readWithVisionChain.mockRejectedValue(
      new Error("429 Too Many Requests — All models exhausted. Soonest reset ~2s.")
    );

    const pending = extractFromScreenshot("google", screenshot(), { timeoutMs: 30_000 });
    const assertion = expect(pending).rejects.toThrow(ScreenshotError);
    await vi.advanceTimersByTimeAsync(30_000);
    await assertion;

    expect(mocks.readWithVisionChain).toHaveBeenCalledTimes(3);
  });

  it("rejects a non-image upload before any AI call", async () => {
    await expect(
      extractFromScreenshot("google", new File(["x"], "doc.pdf", { type: "application/pdf" }), {
        timeoutMs: 5_000,
      })
    ).rejects.toThrow(/not an image/i);

    expect(mocks.readWithVisionChain).not.toHaveBeenCalled();
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
