import { describe, it, expect, vi, afterEach } from 'vitest';

/**
 * The single-chain contract with the FreeLLMAPI dashboard: a typo in the
 * chain name is a 400 at runtime, not a silent fallback. Pin it exactly.
 */
describe('AI chains', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('defaults to the auto:main chain', async () => {
    vi.stubEnv('AI_MAIN_CHAIN', '');
    const { AI_CHAINS } = await import('@/lib/ai/chains');
    expect(AI_CHAINS.main).toBe('auto:main');
  });

  it('keeps the auto: prefix and a slug body', async () => {
    vi.stubEnv('AI_MAIN_CHAIN', '');
    const { AI_CHAINS } = await import('@/lib/ai/chains');
    expect(AI_CHAINS.main).toMatch(/^auto:[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('uses AI_MAIN_CHAIN when the operator renames the chain', async () => {
    vi.stubEnv('AI_MAIN_CHAIN', 'auto:fast-lane');
    const { AI_CHAINS } = await import('@/lib/ai/chains');
    expect(AI_CHAINS.main).toBe('auto:fast-lane');
  });
});
