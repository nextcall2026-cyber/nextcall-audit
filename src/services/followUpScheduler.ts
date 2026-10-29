import "server-only";
import { followUpAutomationService } from "@/services/followUpAutomationService";
import { logger } from "@/lib/logger";

const SWEEP_INTERVAL_MS = 15 * 60 * 1000; // every 15 minutes
const FIRST_SWEEP_DELAY_MS = 30 * 1000; // 30 seconds after server boot

let started = false;

/**
 * Starts the background follow-up automation sweep.
 * Called once from instrumentation.ts at server startup (Node runtime).
 */
export function startFollowUpScheduler(): void {
  if (started) return;

  // Escape hatch for local work against the real database: FOLLOWUP_AUTOMATION=off
  // keeps the sweep from firing from a dev server. Automation stays ON unless
  // that value is set explicitly.
  if (process.env.FOLLOWUP_AUTOMATION === "off") {
    logger.info("[FollowUpScheduler] FOLLOWUP_AUTOMATION=off — follow-up automation not started.");
    return;
  }

  started = true;

  setTimeout(() => {
    void followUpAutomationService.runSweep();
  }, FIRST_SWEEP_DELAY_MS);

  setInterval(() => {
    void followUpAutomationService.runSweep();
  }, SWEEP_INTERVAL_MS);

  logger.info(
    `[FollowUpScheduler] Follow-up automation started (first sweep in ${FIRST_SWEEP_DELAY_MS / 1000}s, then every ${SWEEP_INTERVAL_MS / 60000} min).`
  );
}
