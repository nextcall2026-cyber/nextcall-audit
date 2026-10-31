import { describe, it, expect } from 'vitest';
import { AI_CHAINS, bulkLaneFor } from '@/lib/ai/chains';

/**
 * These strings are the contract with the FreeLLMAPI dashboard: a typo is a
 * 400 at runtime, not a silent fallback. Pin them exactly.
 */
describe('AI chains', () => {
  it('matches the chain names configured in the router, character for character', () => {
    expect(AI_CHAINS).toEqual({
      visionListing: 'auto:vision-listing',
      visionSocial: 'auto:vision-social',
      bulkLane1: 'auto:bulk-lane-1',
      bulkLane2: 'auto:bulk-lane-2',
      bulkLane3: 'auto:bulk-lane-3',
      reportMain: 'auto:report-main',
      reportBackup: 'auto:report-backup',
      copywriter: 'auto:copywriter',
      followup: 'auto:followup',
      microCopy: 'auto:micro-copy',
      longContext: 'auto:longcontext',
    });
  });

  it('keeps the auto: prefix and a slug body on every chain', () => {
    for (const name of Object.values(AI_CHAINS)) {
      expect(name).toMatch(/^auto:[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it('spreads scraper workers across the three bulk lanes', () => {
    expect(bulkLaneFor(0)).toBe('auto:bulk-lane-1');
    expect(bulkLaneFor(1)).toBe('auto:bulk-lane-2');
    expect(bulkLaneFor(2)).toBe('auto:bulk-lane-3');
    expect(bulkLaneFor(3)).toBe('auto:bulk-lane-1');
  });
});
