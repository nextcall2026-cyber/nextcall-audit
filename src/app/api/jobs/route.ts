import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { jobQueueService } from "@/services/jobQueueService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * The queue, for the screenshot page.
 *
 * GET  — the newest jobs plus per-status counts (the panel polls this).
 * POST — put a DEAD job back in the queue after the operator fixed the cause.
 */

export const dynamic = "force-dynamic";

const RetrySchema = z.object({ id: z.string().min(1) });

export async function GET() {
  try {
    const [jobs, stats] = await Promise.all([
      jobQueueService.listRecent(15),
      jobQueueService.stats(),
    ]);

    return NextResponse.json({
      jobs: jobs.map((job) => ({
        id: job.id,
        businessName: job.businessName,
        businessId: job.businessId,
        status: job.status,
        stage: job.stage,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
        lastError: job.lastError,
        note: job.note ?? null,
        phase: job.phase ?? null,
        engine: job.engine ?? null,
        createdAt: job.createdAt,
        finishedAt: job.finishedAt,
        /** Queued but waiting on a retry delay. */
        waitingUntil: job.status === "QUEUED" && job.attempts > 0 ? job.nextAttemptAt : null,
      })),
      stats,
    });
  } catch (error) {
    logger.error("[API /jobs] Fetch failed:", getErrorMessage(error));
    return NextResponse.json({ error: "Could not load the queue." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = RetrySchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    }

    const ok = await jobQueueService.retry(parsed.data.id);
    if (!ok) {
      return NextResponse.json({ error: "That job could not be re-queued." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error("[API /jobs] Retry failed:", getErrorMessage(error));
    return NextResponse.json({ error: "Could not re-queue that job." }, { status: 500 });
  }
}
