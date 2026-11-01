import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AI_CHAINS } from "@/lib/ai/chains";
import { isChainSlow, recordChainTiming, resetChainHealth } from "@/lib/ai/chainHealth";
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
    resetChainHealth();
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
    const assertion = expect(pending).rejects.toThrow(/did not answer in time/i);
    await vi.advanceTimersByTimeAsync(6_000);

    await assertion;
  });

  it("leads with the other chain once the usual one is known to be slow", async () => {
    // auto:vision-listing took 40s last time — do not make the next upload pay
    // the 6s head start again.
    recordChainTiming(AI_CHAINS.visionListing, 40_000, false);
    mocks.generateLLMResponse.mockResolvedValue(reply({ name: "Fast Co" }));

    const result = await extractFromScreenshot("google", screenshot(), { timeoutMs: 5_000 });

    expect(result.name).toBe("Fast Co");
    expect(mocks.generateLLMResponse).toHaveBeenCalledTimes(1);
    expect(mocks.generateLLMResponse.mock.calls[0][0].model).toBe(AI_CHAINS.visionSocial);
  });

  it("remembers a chain that answered, but too slowly", async () => {
    recordChainTiming(AI_CHAINS.visionListing, 20_000, true);
    expect(isChainSlow(AI_CHAINS.visionListing)).toBe(true);

    recordChainTiming(AI_CHAINS.visionListing, 2_000, true);
    expect(isChainSlow(AI_CHAINS.visionListing)).toBe(false);
  });

  it("waits out a rate limit and retries instead of failing the upload", async () => {
    vi.useFakeTimers();

    let calls = 0;
    mocks.generateLLMResponse.mockImplementation(() => {
      calls += 1;
      if (calls === 1) {
        return Promise.reject(
          new Error(
            '429 Too Many Requests — {"error":{"message":"All models exhausted: 6 routes checked (5 rate-limited or on cooldown, 1 model lacks vision). Soonest reset ~4s."}}'
          )
        );
      }
      return Promise.resolve(reply({ name: "Answered after the wait" }));
    });

    const pending = extractFromScreenshot("google", screenshot(), { timeoutMs: 40_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    const result = await pending;

    expect(result.name).toBe("Answered after the wait");
    // At least the original call plus the retry after the rate limit. The hedge
    // may add one more — that is fine, whichever answers first wins.
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("tells the operator the models are busy, not that the image is bad", async () => {
    vi.useFakeTimers();

    mocks.generateLLMResponse.mockRejectedValue(
      new Error('429 Too Many Requests — All models exhausted. Soonest reset ~2s.')
    );

    const pending = extractFromScreenshot("google", screenshot(), { timeoutMs: 40_000 });
    const assertion = expect(pending).rejects.toThrow(/briefly busy/i);
    // Two chains × two rate-limit retries of 2.5s each.
    await vi.advanceTimersByTimeAsync(20_000);

    await assertion;
  });
});
