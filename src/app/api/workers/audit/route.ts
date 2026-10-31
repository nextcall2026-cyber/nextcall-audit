import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { authorizeSweep } from "@/lib/sweepAuth";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { jobQueueService } from "@/services/jobQueueService";
import { auditPipelineService, AuditPipelineError } from "@/services/auditPipelineService";
import { notificationService } from "@/services/notificationService";

/**
 * The audit worker.
 *
 * Triggered by an external scheduler (cron-job.org) every minute:
 *   POST /api/workers/audit
 *   x-cron-secret: <CRON_SECRET>
 *
 * One pass:
 *   1. reclaim jobs whose worker died (nothing is ever stranded)
 *   2. claim up to MAX_JOBS jobs, one at a time, inside a time budget
 *   3. mark each DONE or schedule a retry
 *
 * The budget matters: a pass must finish inside one serverless invocation, so
 * a job that would run past it is left QUEUED for the next pass instead of
 * being cut off half-way.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Two audits per pass — each is 15–25s, so this fits a 60s invocation. */
const MAX_JOBS_PER_PASS = 2;

/** Stop claiming new jobs after this, leaving room to write the result. */
const TIME_BUDGET_MS = 45_000;

export async function POST(request: NextRequest) {
  const auth = authorizeSweep({
    headerSecret: request.headers.get("x-cron-secret"),
    querySecret: new URL(request.url).searchParams.get("secret"),
    authorizationHeader: request.headers.get("authorization"),
    authCookie: request.cookies.get("nextcall_auth")?.value ?? null,
    cronSecret: process.env.CRON_SECRET,
    appPassword: env.APP_PASSWORD,
  });

  if (!auth.ok) {
    logger.warn(`[Worker /audit] Rejected: ${auth.reason}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const workerId = `audit-${startedAt}`;

  try {
    const requeued = await jobQueueService.requeueStale();

    let done = 0;
    let failed = 0;
    const results: Array<{ job: string; status: string; message?: string }> = [];

    while (done + failed < MAX_JOBS_PER_PASS && Date.now() - startedAt < TIME_BUDGET_MS) {
      const job = await jobQueueService.claimNext(workerId);
      if (!job) break;

      try {
        const result = await auditPipelineService.run(job.businessId);
        await jobQueueService.complete(job.id);
        done += 1;
        results.push({
          job: job.businessName,
          status: "DONE",
          ...(result.reportMissing ? { message: "AI report missing — regenerated before sending" } : {}),
        });
      } catch (error) {
        const pipelineError =
          error instanceof AuditPipelineError
            ? error
            : new AuditPipelineError("UNKNOWN", "Something went wrong while building this audit.", error);

        const status = await jobQueueService.fail(job, pipelineError.userMessage, pipelineError.code);
        failed += 1;
        results.push({ job: job.businessName, status, message: pipelineError.userMessage });

        // Only the final failure reaches the bell — a job that will retry in a
        // minute should not send three notifications.
        if (status === "DEAD") {
          await notificationService.notify({
            type: "AUTOMATION_ISSUE",
            title: `Audit failed: ${job.businessName}`,
            body: pipelineError.userMessage,
            href: "/dashboard/screenshot",
            businessId: job.businessId,
            dedupeKey: `audit-dead:${job.id}`,
          });
        }

        logger.error(
          `[Worker /audit] ${job.businessName} failed (${pipelineError.code}): ${getErrorMessage(error)}`
        );
      }
    }

    const elapsedMs = Date.now() - startedAt;
    logger.info(
      `[Worker /audit] Pass done in ${elapsedMs}ms — ${done} completed, ${failed} failed, ${requeued} reclaimed.`
    );

    return NextResponse.json({ ok: true, done, failed, requeued, elapsedMs, results });
  } catch (error) {
    logger.error("[Worker /audit] Pass crashed:", getErrorMessage(error));
    return NextResponse.json({ error: "Worker pass failed." }, { status: 500 });
  }
}

/** A GET is handy for uptime checkers and for eyeballing the endpoint. */
export async function GET() {
  const stats = await jobQueueService.stats();
  return NextResponse.json({ worker: "audit", stats });
}
