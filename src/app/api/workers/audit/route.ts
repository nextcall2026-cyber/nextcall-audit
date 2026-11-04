import { NextRequest, NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { authorizeSweep } from "@/lib/sweepAuth";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { warmRouter } from "@/lib/ai/warmup";
import { jobQueueService } from "@/services/jobQueueService";
import { auditPipelineService, AuditPipelineError } from "@/services/auditPipelineService";
import {
  extractFromScreenshot,
  ExtractedScreenshotFields,
  ScreenshotError,
  ScreenshotKind,
} from "@/services/screenshotExtractor";
import { saveBusinessFromScreenshots } from "@/services/businessIngestService";
import { getScreenshotUploadsCollection } from "@/lib/db";
import { AuditJob, ScreenshotUpload } from "@/types";
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
 *   2. claim jobs (an AUDIT, then its follow-up REPORT) one at a time, but
 *      only while the job still fits in the remaining function window
 *   3. mark each DONE or schedule a retry
 *
 * The AI report runs as its own small REPORT job instead of inside the audit
 * job: it was the one step that could outgrow the 60s function limit, and a
 * function killed mid-job is what made every audit cost a retry.
 *
 * Add `?wait=1` to run the pass synchronously and get the summary back — handy
 * for a manual test, never used by the scheduler.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Two jobs per pass — a screenshot job adds an AI read on top of the 15–25s
 *  pipeline; the window below gates how many actually start. */
const MAX_JOBS_PER_PASS = 2;

/** The Vercel function dies at maxDuration (60s); keep a margin for the final
 *  database writes. Everything a pass starts must also end inside this. */
const FUNCTION_BUDGET_MS = 55_000;

/** A job is only claimed when at least this much room is left — every stage
 *  (vision read + crawl + audit, or a report call) fits inside it. */
const JOB_RESERVE_MS = 45_000;

interface PassSummary {
  done: number;
  failed: number;
  requeued: number;
  elapsedMs: number;
  results: Array<{ job: string; status: string; message?: string }>;
}

async function runPass(workerId: string): Promise<PassSummary> {
  const startedAt = Date.now();

  // This pass runs every minute, which makes it the natural keep-alive for the
  // router: a free Render instance sleeps after ~15 minutes idle and then takes
  // 60-95s to answer, which is longer than an upload can wait. A cheap ping
  // here means the operator's next screenshot is read in ~1.5s. The ping runs
  // in the background; the pass waits for it only right before the first AI
  // call — the queue bookkeeping in between needs no AI.
  const warmPromise = warmRouter(8_000);
  let warmAwaited = false;
  const awaitWarm = async (): Promise<void> => {
    if (!warmAwaited) {
      warmAwaited = true;
      await warmPromise;
    }
  };

  const requeued = await jobQueueService.requeueStale();

  let done = 0;
  let failed = 0;
  const results: PassSummary["results"] = [];

  while (done + failed < MAX_JOBS_PER_PASS) {
    // Only claim a job that still has room to finish: the function dies at
    // maxDuration, and a job killed mid-flight wastes an attempt (its lease
    // is only freed after 3 minutes). The first job is claimed right away; a
    // second one only while the reserve still fits.
    const remainingMs = FUNCTION_BUDGET_MS - (Date.now() - startedAt);
    if (remainingMs < JOB_RESERVE_MS) break;

    const job = await jobQueueService.claimNext(workerId);
    if (!job) break;

    try {
      // Report-stage job: the deterministic audit already exists — write its
      // AI report and finish. Text-only, so it always fits the window.
      if (job.stage === "REPORT") {
        await awaitWarm();
        const { generated } = await auditPipelineService.runReportStage(job.businessId);
        await jobQueueService.complete(job.id);
        done += 1;
        results.push({
          job: job.businessName,
          status: "DONE",
          ...(generated ? { message: "AI report ready" } : {}),
        });
        continue;
      }

      // Screenshot-stage job: read the stored uploads with AI, create the
      // business, then run the pipeline on it. Returns null for a duplicate
      // (the job is completed with a note instead).
      const businessId = await ensureBusinessFromScreenshots(job, awaitWarm);

      if (!businessId) {
        done += 1;
        results.push({
          job: job.businessName,
          status: "DONE",
          message: "Duplicate — already in the app, nothing queued",
        });
        continue;
      }

      const result = await auditPipelineService.run(businessId);
      await jobQueueService.complete(job.id);
      done += 1;
      results.push({
        job: job.businessName,
        status: "DONE",
        ...(result.needsReport ? { message: "Audit ready — AI report queued" } : {}),
      });

      // The AI report runs as its own small job in this same queue — picked up
      // right away if the window still fits, otherwise by the next pass. That
      // is what keeps every single job inside the function's time limit.
      if (result.needsReport) {
        await jobQueueService.enqueue({
          businessId,
          businessName: job.businessName,
          stage: "REPORT",
        });
      }
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

/**
 * Screenshot-stage jobs: read the stored uploads with the vision chain
 * (NVIDIA first, then the Grok slot, then the FreeLLMApi router) — both reads
 * in parallel — then create the business and stamp it on the job.
 *
 * Resumable by design: once the business is saved (and stamped on the job)
 * the uploads are deleted, so a retry skips straight to the pipeline instead
 * of re-reading the same images. A duplicate completes the job as DONE and
 * returns null.
 */
async function ensureBusinessFromScreenshots(
  job: AuditJob,
  awaitWarm: () => Promise<void>
): Promise<string | null> {
  const screenshots = job.screenshots;

  if (!screenshots) return job.businessId || null;

  // Resumed run: the business already exists, the pipeline continues.
  if (job.businessId) return job.businessId;

  const collection = await getScreenshotUploadsCollection();
  const ids = screenshots.facebookId
    ? [screenshots.googleId, screenshots.facebookId]
    : [screenshots.googleId];
  const docs = (await collection
    .find({ id: { $in: ids } })
    .toArray()) as unknown as ScreenshotUpload[];
  const google = docs.find((d) => d.kind === "google");
  const facebook = docs.find((d) => d.kind === "facebook");

  if (!google) {
    throw new AuditPipelineError(
      "SCREENSHOT_MISSING",
      "The stored screenshot could not be found any more. Add the business again."
    );
  }

  // Both screenshots are read by the vision chain in ONE parallel step —
  // Google is required, Facebook is best-effort. Browser OCR was removed:
  // the vision model proved 100% correct on real listings where OCR mangled
  // ratings, dropped websites and even invented a name out of a UI header.
  const visionRead = async (
    kind: ScreenshotKind,
    upload: ScreenshotUpload,
    timeoutMs: number
  ): Promise<{ fields: ExtractedScreenshotFields | null; error: unknown }> => {
    await awaitWarm();
    try {
      return {
        fields: await extractFromScreenshot(
          kind,
          { bytes: Buffer.from(upload.dataBase64, "base64"), mimeType: upload.mimeType },
          { timeoutMs }
        ),
        error: null,
      };
    } catch (error) {
      return { fields: null, error };
    }
  };

  const [googleRead, facebookRead] = await Promise.all([
    google
      ? visionRead("google", google, 30_000)
      : Promise.resolve({ fields: null, error: null as unknown }),
    facebook
      ? visionRead("facebook", facebook, 25_000)
      : Promise.resolve({ fields: null, error: null as unknown }),
  ]);

  if (!googleRead.fields) {
    const error = googleRead.error;
    if (error instanceof ScreenshotError) {
      throw new AuditPipelineError("SCREENSHOT_READ_FAILED", error.userMessage, error);
    }
    throw error ?? new Error("The Google screenshot read failed without an error.");
  }
  const googleFields: ExtractedScreenshotFields = googleRead.fields;

  // Facebook is best-effort: no page (or an unreadable one) still leaves a
  // runnable audit — the website crawl gets a chance at the email instead.
  let facebookFields: ExtractedScreenshotFields | null = facebookRead.fields;
  if (facebook && !facebookRead.fields) {
    logger.warn(
      `[Worker /audit] Facebook read failed, continuing without it: ${getErrorMessage(facebookRead.error)}`
    );
    facebookFields = null;
  }

  const name = googleFields?.name?.trim() || facebookFields?.name?.trim() || "";
  if (!name) {
    throw new AuditPipelineError(
      "SCREENSHOT_UNREADABLE",
      "The business name could not be read from the screenshots. Take the Google screenshot again with the name clearly visible, then add the business again."
    );
  }

  const { business, duplicateOf } = await saveBusinessFromScreenshots(googleFields, facebookFields);

  // Delete the uploads before the pipeline: the reads are done, and this
  // keeps a failed pipeline retry from re-reading (and re-paying for) them.
  await collection.deleteMany({ id: { $in: docs.map((d) => d.id) } });
  await jobQueueService.attachBusiness(job.id, business.id, business.name);
  job.businessId = business.id;
  job.businessName = business.name;

  if (duplicateOf) {
    await notificationService.notify({
      type: "AUTOMATION_ISSUE",
      title: `Duplicate skipped: ${business.name}`,
      body: "These screenshots matched a business that is already in your app, so no second audit was built.",
      href: "/dashboard/screenshot",
      businessId: duplicateOf.id,
      dedupeKey: `screenshot-duplicate:${duplicateOf.id}`,
    });
    await jobQueueService.complete(job.id);
    return null;
  }

  return business.id;
}
