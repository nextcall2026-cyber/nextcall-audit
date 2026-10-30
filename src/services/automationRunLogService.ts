import "server-only";

import { getSettingsCollection } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * Bookkeeping for the automatic sending cadence.
 *
 * The app has no always-on scheduler on a serverless host, so the pass is
 * driven by whatever request arrives (dashboard heartbeat, cron) and this
 * marker decides whether enough time has passed to run it again.
 */

const RUN_DOC_ID = "automation-heartbeat";

/** Sends must not fire more often than this. */
export const PASS_INTERVAL_MS = 15 * 60 * 1000;

export interface AutomationRunState {
  lastRunAt: string | null;
  lastResult: string | null;
}

export interface AutomationRunStateWithDue extends AutomationRunState {
  dueInMs: number;
}

/** Pure: is the next pass due? */
export function isPassDue(
  lastRunAt: string | null,
  now: number,
  intervalMs: number = PASS_INTERVAL_MS
): boolean {
  if (!lastRunAt) return true;
  const last = new Date(lastRunAt).getTime();
  if (!Number.isFinite(last)) return true;
  return now - last >= intervalMs;
}

function toState(raw: unknown): AutomationRunState {
  const doc = (raw ?? {}) as Record<string, unknown>;
  return {
    lastRunAt: typeof doc.lastRunAt === "string" ? doc.lastRunAt : null,
    lastResult: typeof doc.lastResult === "string" ? doc.lastResult : null,
  };
}

class AutomationRunLogService {
  async getState(): Promise<AutomationRunState> {
    try {
      const collection = await getSettingsCollection();
      return toState(await collection.findOne({ id: RUN_DOC_ID }));
    } catch (error) {
      logger.warn(
        "[AutomationRunLog] Could not read the run marker:",
        getErrorMessage(error)
      );
      return { lastRunAt: null, lastResult: null };
    }
  }

  async markRun(result: string): Promise<void> {
    try {
      const collection = await getSettingsCollection();
      await collection.updateOne(
        { id: RUN_DOC_ID },
        {
          $set: {
            id: RUN_DOC_ID,
            lastRunAt: new Date().toISOString(),
            lastResult: result.slice(0, 300),
          },
        },
        { upsert: true }
      );
    } catch (error) {
      logger.warn(
        "[AutomationRunLog] Could not write the run marker:",
        getErrorMessage(error)
      );
    }
  }
}

export const automationRunLogService = new AutomationRunLogService();