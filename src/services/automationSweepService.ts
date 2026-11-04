import "server-only";

import { followUpAutomationService } from "@/services/followUpAutomationService";
import { autoSendService, AutoSendReport } from "@/services/autoSendService";
import { dailyDigestService } from "@/services/dailyDigestService";
import { notificationService } from "@/services/notificationService";
import { getScreenshotUploadsCollection } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * One automation pass: follow-up sequence, auto-send of the initial audit
 * email, the daily digest, and notification housekeeping.
 *
 * Shared by the HTTP sweep endpoint (external cron / dashboard "Run now") and
 * the in-process scheduler, so both entry points can never drift apart.
 */

export interface FollowUpSweepReport {
  sent?: number;
  checked?: number;
  error?: string;
}

export interface AutomationSweepResult {
  ok: boolean;
  autoSend: AutoSendReport | null;
  followUps: FollowUpSweepReport;
  digest: { sent: boolean };
  prunedNotifications: number;
  prunedScreenshots: number;
  durationMs: number;
  ran: string[];
  error?: string;
}

/** Which parts of the pass to run. Everything runs by default. */
export interface SweepParts {
  followUps: boolean;
  autoSend: boolean;
  digest: boolean;
  prune: boolean;
}

const ALL_PARTS: SweepParts = {
  followUps: true,
  autoSend: true,
  digest: true,
  prune: true,
};

/** Parses "autoSend,followUps" from a query string; null when absent. */
export function parseSweepParts(raw: string | null): Partial<SweepParts> | null {
  if (!raw) return null;
  const wanted = new Set(
    raw
      .split(",")
      .map((part) => part.trim().toLowerCase())
      .filter(Boolean)
  );
  if (wanted.size === 0) return null;
  return {
    followUps: wanted.has("followups"),
    autoSend: wanted.has("autosend"),
    digest: wanted.has("digest"),
    prune: wanted.has("prune"),
  };
}

export async function runAutomationSweep(
  parts: SweepParts = ALL_PARTS
): Promise<AutomationSweepResult> {
  const startedAt = Date.now();
  const result: AutomationSweepResult = {
    ok: true,
    autoSend: null,
    followUps: {},
    digest: { sent: false },
    prunedNotifications: 0,
    prunedScreenshots: 0,
    durationMs: 0,
    ran: [],
  };

  try {
    // The follow-up sweep is independent: a failure there must not stop the
    // initial emails (those are the ones waiting in the pipeline).
    if (parts.followUps) {
      result.ran.push("followUps");
      try {
        await followUpAutomationService.runSweep();
      } catch (error) {
        result.followUps = { error: getErrorMessage(error) };
        logger.error("[AutomationSweep] Follow-up sweep failed:", getErrorMessage(error));
      }
    }

    if (parts.autoSend) {
      result.ran.push("autoSend");
      // One email — the send worker's 2-minute cron owns the pacing; the sweep
      // must never burst-send on top of it.
      result.autoSend = await autoSendService.runPass({ maxSends: 1 });
    }
    if (parts.digest) {
      result.ran.push("digest");
      result.digest = await dailyDigestService.maybeSendDigest();
    }
    if (parts.prune) {
      result.ran.push("prune");
      result.prunedNotifications = await notificationService.prune(30);
      result.prunedScreenshots = await pruneStaleScreenshots();
    }
  } catch (error) {
    result.ok = false;
    result.error = getErrorMessage(error);
    logger.error("[AutomationSweep] Failed:", result.error);

    await notificationService.notify({
      type: "AUTOMATION_ISSUE",
      title: "Automation sweep failed",
      body: result.error.slice(0, 300),
      dedupeKey: "automation-sweep-failed",
    });
  }

  result.durationMs = Date.now() - startedAt;
  return result;
}

/**
 * Deletes screenshots nobody picked up — uploads whose job never completed
 * (DEAD after max retries, or lost in a crash before the business was saved).
 * Normally the worker deletes each upload right after reading it; this is the
 * safety net that keeps storage flat.
 */
async function pruneStaleScreenshots(hoursOld = 24): Promise<number> {
  try {
    const collection = await getScreenshotUploadsCollection();
    const cutoff = new Date(Date.now() - hoursOld * 60 * 60_000).toISOString();
    const result = await collection.deleteMany({ createdAt: { $lt: cutoff } });
    const deleted = result.deletedCount ?? 0;
    if (deleted > 0) logger.info(`[AutomationSweep] Pruned ${deleted} stale screenshot upload(s).`);
    return deleted;
  } catch (error) {
    logger.warn(`[AutomationSweep] Screenshot prune failed: ${getErrorMessage(error)}`);
    return 0;
  }
}