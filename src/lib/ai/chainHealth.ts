import "server-only";

/**
 * Remembers which vision chain was slow last time, so the next screenshot
 * starts with the other one.
 *
 * The hedge in screenshotExtractor already guarantees a slow chain cannot fail
 * a read — but it still costs the 6s head start on every single upload. When
 * one chain is stuck at 40s for hours (as auto:vision-listing was), the app
 * should quietly stop leading with it instead of waiting for the operator to
 * reorder models in the router dashboard.
 *
 * Deliberately in-memory: this is a routing hint, not state. A cold instance
 * simply starts with the default order again, which costs one extra hedge and
 * nothing else.
 */

/** A read slower than this is treated as "this chain is not answering". */
const SLOW_MS = 15_000;

/** How long the hint lasts before the chain gets another chance to lead. */
const MEMORY_MS = 10 * 60_000;

interface ChainMemory {
  slowUntil: number;
  lastDurationMs: number;
  lastOk: boolean;
  lastAt: number;
}

const memory = new Map<string, ChainMemory>();

/**
 * Records how a chain behaved. `ok` means "the chain answered" — an unusable
 * reply is still an answer, so it must not be blamed on the chain's speed.
 */
export function recordChainTiming(chain: string, durationMs: number, ok: boolean): void {
  const slow = !ok || durationMs >= SLOW_MS;
  memory.set(chain, {
    slowUntil: slow ? Date.now() + MEMORY_MS : 0,
    lastDurationMs: durationMs,
    lastOk: ok,
    lastAt: Date.now(),
  });
}

/** True while the chain is remembered as slow or failing. */
export function isChainSlow(chain: string, now: number = Date.now()): boolean {
  const entry = memory.get(chain);
  return Boolean(entry && entry.slowUntil > now);
}

/** Snapshot for diagnostics/tests. */
export function chainHealthSnapshot(): Array<{
  chain: string;
  slow: boolean;
  lastDurationMs: number | null;
  lastOk: boolean | null;
  lastAt: number | null;
}> {
  return Array.from(memory.entries()).map(([chain, entry]) => ({
    chain,
    slow: entry.slowUntil > Date.now(),
    lastDurationMs: entry.lastDurationMs,
    lastOk: entry.lastOk,
    lastAt: entry.lastAt,
  }));
}

/** Test helper. */
export function resetChainHealth(): void {
  memory.clear();
}
