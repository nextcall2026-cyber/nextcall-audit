/**
 * Minimal per-provider circuit breaker for the LLM gateway.
 *
 * Purpose: when the primary provider is *persistently* down (e.g. Gemini out
 * of credit), we should not pay its failure latency on every request. After a
 * failure with a non-zero cooldown the breaker "opens" and the gateway skips
 * straight to the next provider until the cooldown elapses, then lets the
 * primary through again (half-open probe).
 *
 * State is in-memory per server instance — good enough for a single-process
 * Next.js deployment, and safe-by-default everywhere else (worst case: each
 * instance learns about the failure independently).
 */

import type { ProviderErrorKind, ProviderId } from "./types";

interface BreakerState {
  /** Epoch ms until which the provider is skipped. 0 = closed (healthy). */
  openUntil: number;
  lastErrorKind: ProviderErrorKind | null;
  lastErrorMessage: string | null;
  lastFailureAt: number | null;
  consecutiveFailures: number;
}

export const PROVIDER_COOLDOWN_MS: Record<ProviderErrorKind, number> = {
  quota: 10 * 60 * 1000, // out of credit / hard quota — won't fix itself soon
  auth: 10 * 60 * 1000, // invalid or unauthorized key — config problem
  "rate-limit": 60 * 1000, // per-minute burst limit — recovers quickly
  transient: 60 * 1000, // 5xx / timeout / network — retry soon
  blocked: 0, // content-specific, other requests may be fine
  "bad-request": 0, // request-specific, do not park the provider
  empty: 0, // one-off empty response, do not park the provider
};

export class CircuitBreaker {
  private state = new Map<ProviderId, BreakerState>();

  private get(id: ProviderId): BreakerState {
    let s = this.state.get(id);
    if (!s) {
      s = {
        openUntil: 0,
        lastErrorKind: null,
        lastErrorMessage: null,
        lastFailureAt: null,
        consecutiveFailures: 0,
      };
      this.state.set(id, s);
    }
    return s;
  }

  canAttempt(id: ProviderId, now: number = Date.now()): boolean {
    const s = this.state.get(id);
    if (!s) return true;
    return s.openUntil === 0 || now >= s.openUntil;
  }

  cooldownRemainingMs(id: ProviderId, now: number = Date.now()): number {
    const s = this.state.get(id);
    if (!s || s.openUntil === 0) return 0;
    return Math.max(0, s.openUntil - now);
  }

  isOpen(id: ProviderId, now: number = Date.now()): boolean {
    return this.cooldownRemainingMs(id, now) > 0;
  }

  recordFailure(
    id: ProviderId,
    kind: ProviderErrorKind,
    message: string,
    now: number = Date.now()
  ): void {
    const s = this.get(id);
    s.consecutiveFailures += 1;
    s.lastErrorKind = kind;
    s.lastErrorMessage = message;
    s.lastFailureAt = now;
    const cooldown = PROVIDER_COOLDOWN_MS[kind];
    s.openUntil = cooldown > 0 ? now + cooldown : 0;
  }

  recordSuccess(id: ProviderId): void {
    this.state.delete(id);
  }

  snapshot(id: ProviderId, now: number = Date.now()): {
    isOpen: boolean;
    cooldownRemainingMs: number;
    lastErrorKind: string | null;
    lastErrorMessage: string | null;
    lastFailureAt: number | null;
    consecutiveFailures: number;
  } {
    const s = this.get(id);
    const remaining = s.openUntil === 0 ? 0 : Math.max(0, s.openUntil - now);
    return {
      isOpen: remaining > 0,
      cooldownRemainingMs: remaining,
      lastErrorKind: s.lastErrorKind,
      lastErrorMessage: s.lastErrorMessage,
      lastFailureAt: s.lastFailureAt,
      consecutiveFailures: s.consecutiveFailures,
    };
  }

  /** Test helper: clear all state. */
  reset(): void {
    this.state.clear();
  }
}

export const breaker = new CircuitBreaker();
