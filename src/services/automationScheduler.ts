import "server-only";

import { runAutomationSweep } from "@/services/automationSweepService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
const FIRST_SWEEP_DELAY_MS = 30 * 1000; // 30 seconds after server boot

let started = false;

/**
 * Starts the background automation pass: follow-ups, auto-send of the initial
 * audit email, the daily digest and notification housekeeping.
 *
 * Called once from instrumentation.ts at server startup (Node runtime).
 *
 * This is the in-process half of the schedule. A deployment that freezes idle
 * instances (Vercel serverless) should ALSO point an external scheduler at
 * /api/automation/sweep every 15 minutes — or the operator can press "Run now"
 * on the notifications page, which hits the same pass.
 *
 * Set AUTOMATION_SCHEDULER=off (or the older FOLLOWUP_AUTOMATION=off) to keep
 * a local dev server from emailing real prospects in the shared database.
 */
export function startAutomationScheduler(): void {
  if (started) return;

  if (
    process.env.AUTOMATION_SCHEDULER === "off" ||
    process.env.FOLLOWUP_AUTOMATION === "off"
  ) {
    logger.info(
      "[AutomationScheduler] Scheduler disabled by env (AUTOMATION_SCHEDULER/FOLLOWUP_AUTOMATION=off)."
    );
    return;
  }

  started = true;

  const runPass = async (label: string) => {
    try {
      const result = await runAutomationSweep();
      const autoSend = result.autoSend;
      logger.info(
        `[AutomationScheduler] ${label} pass in ${result.durationMs}ms — auto-send: ${
          autoSend ? `${autoSend.sent} sent, ${autoSend.candidates} candidate(s)${autoSend.dryRun ? " (dry run)" : ""}${autoSend.skipped ? `, skipped: ${autoSend.skipped}` : ""}` : "not run"
        }.`
      );
    } catch (error) {
      logger.error(`[AutomationScheduler] ${label} pass failed:`, getErrorMessage(error));
    }
  };

  setTimeout(() => {
    void runPass("first");
  }, FIRST_SWEEP_DELAY_MS);

  setInterval(() => {
    void runPass("scheduled");
  }, SWEEP_INTERVAL_MS);

  logger.info(
    `[AutomationScheduler] Automation started (first pass in ${FIRST_SWEEP_DELAY_MS / 1000}s, then every ${SWEEP_INTERVAL_MS / 60000} min): follow-ups + auto-send + digest.`
  );
}