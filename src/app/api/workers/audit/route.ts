import { NextRequest, NextResponse, after } from "next/server";
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
 * The response is sent IMMEDIATELY (202) and the pass runs in `after()`, which
 * keeps executing after the response leaves. That matters because the free
 * schedulers hang up after 30 seconds while an audit pass may take 45 — with a
 * plain synchronous handler the scheduler would record a timeout and, worse,
 * the connection could be dropped mid-audit.
 *
 * One pass:
 *   1. reclaim jobs whose worker died (nothing is ever stranded)
 *   2. claim up to MAX_JOBS jobs, one at a time, inside a time budget
 *   3. mark each DONE or schedule a retry
 *
 * Add `?wait=1` to run the pass synchronously and get the summary back — handy
 * for a manual test, never used by the scheduler.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Two audits per pass — each is 15–25s, so this fits a 60s invocation. */
const MAX_JOBS_PER_PASS = 2;

/** Stop claiming new jobs after this, leaving room to write the result. */
const TIME_BUDGET_MS = 45_000;

interface PassSummary {
  done: number;
  failed: number;
  requeued: number;
  elapsedMs: number;
  results: Array<{ job: string; status: string; message?: string }>;
}

async function runPass(workerId: string): Promise<PassSummary> {
  const startedAt = Date.now();
  const requeued = await jobQueueService.requeueStale();

  let done = 0;
  let failed = 0;
  const results: PassSummary["results"] = [];

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

  return { done, failed, requeued, elapsedMs, results };
}

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

  const workerId = `audit-${Date.now()}`;
  const wantsToWait = new URL(request.url).searchParams.get("wait") === "1";

  // Manual test: answer with the real summary.
  if (wantsToWait) {
    try {
      const summary = await runPass(workerId);
      return NextResponse.json({ ok: true, ...summary });
    } catch (error) {
      logger.error("[Worker /audit] Pass crashed:", getErrorMessage(error));
      return NextResponse.json({ error: "Worker pass failed." }, { status: 500 });
    }
  }

  // Scheduler: hang up now, keep working. The scheduler's 30s limit stops
  // mattering, and its history shows a clean 202 instead of a timeout.
  after(async () => {
    try {
      await runPass(workerId);
    } catch (error) {
      logger.error("[Worker /audit] Background pass crashed:", getErrorMessage(error));
    }
  });

  return NextResponse.json({ accepted: true, worker: workerId }, { status: 202 });
}

/** A GET is handy for uptime checkers and for eyeballing the endpoint. */
export async function GET() {
  const stats = await jobQueueService.stats();
  return NextResponse.json({ worker: "audit", stats });
}
