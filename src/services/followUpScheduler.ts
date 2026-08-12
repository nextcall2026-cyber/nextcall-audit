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
