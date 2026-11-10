import { describe, expect, it, vi } from 'vitest';

// The pure helpers are what the workers' gate leans on — test them without a
// database (the service itself is covered by the engine API's fail-closed
// behaviour, not here).
vi.mock('@/lib/db', () => ({
  getSettingsCollection: async () => {
    throw new Error('not used in this test');
  },
}));

import {
  ENGINE_LIVE_TTL_MS,
  defaultEngineState,
  engineLiveReason,
  isHeartbeatFresh,
} from '@/services/engineStateService';

const NOW = Date.parse('2026-11-10T10:00:00.000Z');

describe('isHeartbeatFresh', () => {
  it('is fresh within the TTL', () => {
    // 20 minutes old — well inside the 30-minute window.
    expect(isHeartbeatFresh('2026-11-10T09:40:00.000Z', NOW)).toBe(true);
  });

  it('is stale past the TTL', () => {
    // 31 minutes old — the engine must look OFF to every worker.
    expect(isHeartbeatFresh('2026-11-10T09:29:00.000Z', NOW)).toBe(false);
  });

  it('treats exactly TTL-old as fresh (boundary)', () => {
    const exactlyTtlOld = new Date(NOW - ENGINE_LIVE_TTL_MS).toISOString();
    expect(isHeartbeatFresh(exactlyTtlOld, NOW)).toBe(true);
  });

  it('is never fresh without a heartbeat', () => {
    expect(isHeartbeatFresh(null, NOW)).toBe(false);
    expect(isHeartbeatFresh('not-a-date', NOW)).toBe(false);
  });
});

describe('engineLiveReason', () => {
  it('says "off" for a switch that was turned off by the operator', () => {
    const state = { ...defaultEngineState(), on: false, lastOffReason: 'operator' };
    expect(engineLiveReason(state, NOW)).toBe('off');
  });

  it('says "auto-off" when the TTL expired and was stamped', () => {
    const state = { ...defaultEngineState(), on: false, lastOffReason: 'auto-off — 30 minutes without activity' };
    expect(engineLiveReason(state, NOW)).toBe('auto-off');
  });

  it('says "stale-heartbeat" for ON with an expired heartbeat', () => {
    const state = { ...defaultEngineState(), on: true, lastHeartbeatAt: '2026-11-10T09:00:00.000Z' };
    expect(engineLiveReason(state, NOW)).toBe('stale-heartbeat');
  });

  it('says "no-heartbeat" for ON that never heartbeated', () => {
    const state = { ...defaultEngineState(), on: true };
    expect(engineLiveReason(state, NOW)).toBe('no-heartbeat');
  });

  it('says "on" only for ON with a fresh heartbeat', () => {
    const state = { ...defaultEngineState(), on: true, lastHeartbeatAt: '2026-11-10T09:45:00.000Z' };
    expect(engineLiveReason(state, NOW)).toBe('on');
  });
});
