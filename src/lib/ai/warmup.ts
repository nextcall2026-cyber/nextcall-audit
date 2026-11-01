import "server-only";

import { logger } from "@/lib/logger";

/**
 * Keeps the FreeLLMAPI router awake.
 *
 * The router runs on a free Render instance, which sleeps after ~15 minutes of
 * inactivity. The first request after that takes 60–95 seconds just to boot —
 * far longer than an upload can wait, so the read times out and the operator
 * sees a misleading "could not be read" error even though the screenshot was
 * perfect.
 *
 * A cheap GET /models once a minute keeps the instance warm, so an upload is
 * answered in ~1.5s. The audit worker runs every minute anyway, which is the
 * natural place to do it.
 *
 * It is best-effort by design: a direct provider (Groq, OpenAI) has no cold
 * start, and a failed warm-up must never fail the request that triggered it.
 */

const SLOTS = [1, 2, 3, 4, 5, 6, 7] as const;

interface SlotConfig {
  slot: number;
  baseUrl: string;
  access: string;
}

/** Every configured OpenAI-compatible slot — one router each, in practice. */
function configuredSlots(): SlotConfig[] {
  const slots: SlotConfig[] = [];
  for (const slot of SLOTS) {
    const baseUrl = (process.env[`FREE${slot}_BASE_URL`] ?? "").trim().replace(/\/+$/, "");
    const access = (process.env[`FREE${slot}_ACCESS`] ?? "").trim();
    if (baseUrl && access) slots.push({ slot, baseUrl, access });
  }
  return slots;
}

async function ping(slot: SlotConfig, timeoutMs: number): Promise<boolean> {
  try {
    const response = await fetch(`${slot.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${slot.access}` },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    return response.status > 0;
  } catch (error) {
    logger.debug(
      `[Warmup] FREE${slot.slot} did not answer in ${timeoutMs}ms: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return false;
  }
}

/**
 * Sends one lightweight request to every configured router, in parallel.
 *
 * With more than one slot each router sleeps on its own schedule, so warming
 * only the first would leave the failover routers cold — exactly the ones the
 * gateway reaches for when the first is struggling.
 *
 * Returns true when at least one instance answered (any status — a 401 still
 * proves it is awake).
 */
export async function warmRouter(timeoutMs = 8_000): Promise<boolean> {
  const slots = configuredSlots();
  if (slots.length === 0) return false;

  const results = await Promise.all(slots.map((slot) => ping(slot, timeoutMs)));
  return results.some(Boolean);
}

/**
 * Fire-and-forget warm-up for request paths that must not wait. Used by the
 * upload route so the *next* upload finds the router already awake.
 */
export function warmRouterInBackground(): void {
  void warmRouter(5_000).catch(() => undefined);
}
