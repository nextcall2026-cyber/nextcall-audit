import "server-only";

import { getSettingsCollection } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * The engine switch — one switch that decides whether the background
 * automation lives or sleeps.
 *
 * The operator works in bursts: a couple of hours a day with the dashboard
 * open, and the rest of the day (and night) the app sits idle. Every worker
 * used to run around the clock anyway, which is what burned the Vercel Hobby
 * CPU quota. The engine flips that around:
 *
 *   - The operator presses ENGINE ON in the dashboard when they start working.
 *   - While the engine is ON, an open dashboard keeps heartbeating — but only
 *     while the tab is visible AND the operator actually interacts.
 *   - Every scheduled caller (cron-job.org, Vercel Cron, the in-process
 *     scheduler) checks the engine first and bows out immediately when it is
 *     OFF: a wake-up costs milliseconds instead of a whole worker pass.
 *   - Manual, cookie-authenticated actions (uploads, "Run now", ?wait=1 tests)
 *     always work — a human pressing a button is a deliberate decision.
 *
 * Auto-off is implicit: "ON" simply means "ON and heartbeated within the TTL".
 * A closed window, a sleeping laptop or a power cut stops the heartbeats, and
 * within the TTL every worker sees the engine as OFF — no separate timer, no
 * cleanup. The stale expiry is stamped into the document, so the dashboard
 * switch can show WHY it went dark.
 */

const ENGINE_DOC_ID = "engine-state";

/** How long the engine stays live without a dashboard heartbeat. */
export const ENGINE_LIVE_TTL_MS = 30 * 60 * 1000;

/** The reason stamped when the TTL expires without a heartbeat. */
export const ENGINE_AUTO_OFF_REASON = "auto-off — 30 minutes without activity";

export interface EngineState {
  on: boolean;
  lastHeartbeatAt: string | null;
  lastOffAt: string | null;
  lastOffReason: string | null;
  updatedAt: string | null;
}

export interface EngineLive {
  /** True only when the switch is ON *and* the heartbeat is fresh. */
  live: boolean;
  /** Raw switch position (may be ON with an expired heartbeat). */
  on: boolean;
  /** "on" | "off" | "auto-off" | "stale-heartbeat" | "no-heartbeat" | "storage-error" */
  reason: string;
  lastHeartbeatAt: string | null;
}

export function defaultEngineState(): EngineState {
  return {
    on: false,
    lastHeartbeatAt: null,
    lastOffAt: null,
    lastOffReason: null,
    updatedAt: null,
  };
}

/** Pure: does this heartbeat timestamp still count as alive at `now`? */
export function isHeartbeatFresh(
  lastHeartbeatAt: string | null,
  now: number,
  ttlMs: number = ENGINE_LIVE_TTL_MS
): boolean {
  if (!lastHeartbeatAt) return false;
  const last = new Date(lastHeartbeatAt).getTime();
  if (!Number.isFinite(last)) return false;
  return now - last <= ttlMs;
}

/** Pure: why is the engine in its current live/not-live state? */
export function engineLiveReason(state: EngineState, now: number): string {
  if (!state.on) {
    return state.lastOffReason === ENGINE_AUTO_OFF_REASON ? "auto-off" : "off";
  }
  if (!state.lastHeartbeatAt) return "no-heartbeat";
  return isHeartbeatFresh(state.lastHeartbeatAt, now) ? "on" : "stale-heartbeat";
}

function toState(raw: unknown): EngineState {
  const doc = (raw ?? {}) as Record<string, unknown>;
  return {
    on: doc.on === true,
    lastHeartbeatAt: typeof doc.lastHeartbeatAt === "string" ? doc.lastHeartbeatAt : null,
    lastOffAt: typeof doc.lastOffAt === "string" ? doc.lastOffAt : null,
    lastOffReason: typeof doc.lastOffReason === "string" ? doc.lastOffReason : null,
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null,
  };
}

class EngineStateService {
  /** Raw stored state. Throws on storage failure (callers decide). */
  private async readState(): Promise<EngineState> {
    const collection = await getSettingsCollection();
    return toState(await collection.findOne({ id: ENGINE_DOC_ID }));
  }

  private async writeState(patch: Partial<EngineState>): Promise<EngineState> {
    const current = await this.readState();
    const next: EngineState = {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    const collection = await getSettingsCollection();
    await collection.updateOne(
      { id: ENGINE_DOC_ID },
      {
        $set: {
          id: ENGINE_DOC_ID,
          on: next.on,
          lastHeartbeatAt: next.lastHeartbeatAt,
          lastOffAt: next.lastOffAt,
          lastOffReason: next.lastOffReason,
          updatedAt: next.updatedAt,
        },
      },
      { upsert: true }
    );
    return next;
  }

  /** The switch position as the dashboard sees it. Throws on storage failure. */
  async getState(): Promise<EngineState> {
    return this.readState();
  }

  /** ENGINE ON — turning it on counts as the first heartbeat. */
  async turnOn(): Promise<EngineState> {
    const next = await this.writeState({
      on: true,
      lastHeartbeatAt: new Date().toISOString(),
    });
    logger.info("[Engine] ON — operator switched the engine on.");
    return next;
  }

  /** ENGINE OFF — every scheduled worker stops at its next wake-up. */
  async turnOff(reason: string): Promise<EngineState> {
    const next = await this.writeState({
      on: false,
      lastOffAt: new Date().toISOString(),
      lastOffReason: reason.slice(0, 120),
    });
    logger.info(`[Engine] OFF — ${next.lastOffReason}.`);
    return next;
  }

  /** A dashboard heartbeat. Never resurrects a switch that is OFF. */
  async heartbeat(): Promise<EngineState> {
    const current = await this.readState();
    if (!current.on) return current;
    return this.writeState({ lastHeartbeatAt: new Date().toISOString() });
  }

  /**
   * The gate every scheduled caller runs through. Fails closed: when storage
   * cannot be read, the scheduled pass does not run (manual actions are not
   * gated and keep working).
   */
  async isAutomationLive(): Promise<EngineLive> {
    let state: EngineState;
    try {
      state = await this.readState();
    } catch (error) {
      logger.warn("[Engine] Could not read the switch:", getErrorMessage(error));
      return { live: false, on: false, reason: "storage-error", lastHeartbeatAt: null };
    }

    const now = Date.now();
    const reason = engineLiveReason(state, now);
    const live = reason === "on";

    // Stamp the auto-off so the dashboard can show why it went dark. Cheap and
    // idempotent — several callers may stamp the same transition.
    if (state.on && !live) {
      try {
        await this.turnOff(ENGINE_AUTO_OFF_REASON);
      } catch (error) {
        logger.warn("[Engine] Could not stamp the auto-off:", getErrorMessage(error));
      }
    }

    return { live, on: state.on, reason, lastHeartbeatAt: state.lastHeartbeatAt };
  }
}

export const engineStateService = new EngineStateService();
