import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AI_CHAINS } from "@/lib/ai/chains";
import { extractFromScreenshot } from "@/services/screenshotExtractor";

const mocks = vi.hoisted(() => ({
  generateLLMResponse: vi.fn(),
}));

vi.mock("@/lib/ai", () => ({
  generateLLMResponse: mocks.generateLLMResponse,
}));

function screenshot(name = "shot.png") {
  return new File([Buffer.from("fake-image")], name, { type: "image/png" });
}

function reply(fields: Record<string, unknown>) {
  return { text: JSON.stringify(fields), provider: "free1", model: "test", fallback: false };
}

describe("screenshot extraction", () => {
  beforeEach(() => {
    mocks.generateLLMResponse.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses the chain that belongs to the screenshot type", async () => {
    mocks.generateLLMResponse.mockResolvedValue(reply({ name: "Acme" }));

    const result = await extractFromScreenshot("google", screenshot(), { timeoutMs: 5_000 });

    expect(result.name).toBe("Acme");
    expect(mocks.generateLLMResponse).toHaveBeenCalledTimes(1);
    expect(mocks.generateLLMResponse.mock.calls[0][0].model).toBe(AI_CHAINS.visionListing);
  });

  it("falls back to the other vision chain when the first one is too slow", async () => {
    vi.useFakeTimers();

    mocks.generateLLMResponse.mockImplementation((request: { model: string }) => {
      if (request.model === AI_CHAINS.visionListing) {
        // Never answers — this is the 40-95s chain seen in production.
        return new Promise(() => undefined);
      }
      return Promise.resolve(reply({ name: "From the backup chain" }));
    });

    const pending = extractFromScreenshot("google", screenshot(), { timeoutMs: 40_000 });
    await vi.advanceTimersByTimeAsync(6_000);
    const result = await pending;

    expect(result.name).toBe("From the backup chain");
    expect(mocks.generateLLMResponse).toHaveBeenCalledTimes(2);
    expect(mocks.generateLLMResponse.mock.calls[1][0].model).toBe(AI_CHAINS.visionSocial);
  });

  it("does not call the second chain when the first one answers quickly", async () => {
    vi.useFakeTimers();

    mocks.generateLLMResponse.mockResolvedValue(reply({ name: "Fast Co" }));

    const pending = extractFromScreenshot("google", screenshot(), { timeoutMs: 40_000 });
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(result.name).toBe("Fast Co");
    expect(mocks.generateLLMResponse).toHaveBeenCalledTimes(1);
  });

  it("tries the backup chain when the reply is unusable JSON", async () => {
    vi.useFakeTimers();

    mocks.generateLLMResponse.mockImplementation((request: { model: string }) =>
      request.model === AI_CHAINS.visionListing
        ? Promise.resolve({ text: "sorry, I cannot read that", provider: "free1", model: "test", fallback: false })
        : Promise.resolve(reply({ name: "Backup Co" }))
    );

    const pending = extractFromScreenshot("google", screenshot(), { timeoutMs: 40_000 });
    await vi.advanceTimersByTimeAsync(6_000);
    const result = await pending;

    expect(result.name).toBe("Backup Co");
  });

  it("explains that the reader was slow, not that the image was bad", async () => {
    vi.useFakeTimers();

    mocks.generateLLMResponse.mockRejectedValue(new Error("No response from router within 40000ms"));

    const pending = extractFromScreenshot("google", screenshot(), { timeoutMs: 40_000 });
    const assertion = expect(pending).rejects.toThrow(/temporary slowdown/i);
    await vi.advanceTimersByTimeAsync(6_000);

    await assertion;
  });
});
