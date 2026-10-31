import "server-only";

import { randomUUID } from "crypto";
import { AuditJob, AuditJobStatus } from "@/types";
import { getAuditJobsCollection } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * The background job queue.
 *
 * One row per unit of slow work (today: "build the audit for this business").
 * The row — not the HTTP request — owns the work, so a worker that dies, a
 * tab that closes or a function that times out never loses anything: the job
 * simply goes back to QUEUED and another worker picks it up.
 *
 * Two guarantees this file is responsible for:
 *
 *   1. ONE JOB, ONE WORKER — `claimNext` is a single conditional update, so
 *      the database hands each job to exactly one caller. Everyone else gets
 *      null and moves on to the next job instead of waiting.
 *   2. NO ORPHANS — every claim stamps `lockedAt`. A job still RUNNING after
 *      STALE_LOCK_MS had its worker die; `requeueStale` puts it back in the
 *      queue. Retries are bounded, and a job that runs out of retries ends as
 *      DEAD (kept, never deleted) so the operator can see and re-queue it.
 */

/** A lease older than this means the worker died mid-job. */
export const STALE_LOCK_MS = 3 * 60_000;

/** Attempts before a job is parked as DEAD. */
export const MAX_ATTEMPTS = 3;

/** Wait before retry N (index = attempt number). */
export const RETRY_DELAYS_MS = [0, 60_000, 120_000];

export interface EnqueueInput {
  businessId: string;
  businessName: string;
}

class JobQueueService {
  /**
   * Adds a job, or returns the one already waiting for this business — a
   * double-click must not audit the same business twice.
   */
  async enqueue(input: EnqueueInput): Promise<AuditJob | null> {
    try {
      const collection = await getAuditJobsCollection();

      const existing = await collection.findOne({
        businessId: input.businessId,
        status: { $in: ["QUEUED", "RUNNING"] },
      });

      if (existing) {
        logger.info(
          `[JobQueue] ${input.businessName} is already queued (${(existing as unknown as AuditJob).id}); not adding again.`
        );
        return existing as unknown as AuditJob;
      }

      const now = new Date().toISOString();
      const job: AuditJob = {
        id: randomUUID(),
        businessId: input.businessId,
        businessName: input.businessName,
        stage: "AUDIT",
        status: "QUEUED",
        attempts: 0,
        maxAttempts: MAX_ATTEMPTS,
        workerId: null,
        lockedAt: null,
        nextAttemptAt: now,
        lastError: null,
        lastErrorCode: null,
        createdAt: now,
        updatedAt: now,
        finishedAt: null,
      };

      await collection.insertOne(job);
      logger.info(`[JobQueue] Queued ${input.businessName} (${job.id}).`);
      return job;
    } catch (error) {
      logger.error("[JobQueue] Enqueue failed:", getErrorMessage(error));
      return null;
    }
  }

  /**
   * Takes the oldest ready job. The status check lives INSIDE the update
   * filter — reading first and updating after would let two workers grab the
   * same row.
   */
  async claimNext(workerId: string): Promise<AuditJob | null> {
    try {
      const collection = await getAuditJobsCollection();
      const now = new Date().toISOString();

      const claimed = await collection.findOneAndUpdate(
        { status: "QUEUED", nextAttemptAt: { $lte: now } },
        { $set: { status: "RUNNING", workerId, lockedAt: now, updatedAt: now } },
        { returnDocument: "after" }
      );

      return (claimed as unknown as AuditJob) ?? null;
    } catch (error) {
      logger.error("[JobQueue] Claim failed:", getErrorMessage(error));
      return null;
    }
  }

  /** Keeps a long job's lease alive. */
  async heartbeat(jobId: string): Promise<void> {
    try {
      const collection = await getAuditJobsCollection();
      await collection.updateOne(
        { id: jobId, status: "RUNNING" },
        { $set: { lockedAt: new Date().toISOString() } }
      );
    } catch (error) {
      logger.warn(`[JobQueue] Heartbeat failed for ${jobId}: ${getErrorMessage(error)}`);
    }
  }

  async complete(jobId: string): Promise<void> {
    try {
      const collection = await getAuditJobsCollection();
      const now = new Date().toISOString();
      await collection.updateOne(
        { id: jobId },
        {
          $set: {
            status: "DONE" as AuditJobStatus,
            lockedAt: null,
            workerId: null,
            lastError: null,
            lastErrorCode: null,
            updatedAt: now,
            finishedAt: now,
          },
        }
      );
      logger.info(`[JobQueue] Job ${jobId} finished.`);
    } catch (error) {
      logger.error(`[JobQueue] Complete failed for ${jobId}:`, getErrorMessage(error));
    }
  }

  /**
   * Records a failed attempt. Retries with a growing delay, then parks the job
   * as DEAD — still listed, so nothing silently disappears.
   */
  async fail(job: AuditJob, message: string, code: string | null = null): Promise<AuditJobStatus> {
    const attempts = job.attempts + 1;
    const exhausted = attempts >= (job.maxAttempts || MAX_ATTEMPTS);
    const now = new Date();

    const delayMs = exhausted ? 0 : RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)];

    const status: AuditJobStatus = exhausted ? "DEAD" : "QUEUED";

    try {
      const collection = await getAuditJobsCollection();
      await collection.updateOne(
        { id: job.id },
        {
          $set: {
            status,
            attempts,
            workerId: null,
            lockedAt: null,
            nextAttemptAt: new Date(now.getTime() + delayMs).toISOString(),
            lastError: message,
            lastErrorCode: code,
            updatedAt: now.toISOString(),
            ...(exhausted ? { finishedAt: now.toISOString() } : {}),
          },
        }
      );

      logger.warn(
        `[JobQueue] Job ${job.id} failed (attempt ${attempts}/${job.maxAttempts}) → ${status}: ${message}`
      );
    } catch (error) {
      logger.error(`[JobQueue] Could not record failure for ${job.id}:`, getErrorMessage(error));
    }

    return status;
  }

  /**
   * Reclaims jobs whose worker died mid-flight. Called at the top of every
   * worker pass, so a killed function can never strand a job.
   */
  async requeueStale(): Promise<number> {
    try {
      const collection = await getAuditJobsCollection();
      const cutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();

      const cursor = collection.find({ status: "RUNNING", lockedAt: { $lt: cutoff } });
      const stale = (await cursor.toArray()) as unknown as AuditJob[];
      if (stale.length === 0) return 0;

      for (const job of stale) {
        await this.fail(job, "The worker stopped before finishing this job. It has been put back in the queue.", "WORKER_LOST");
      }

      logger.warn(`[JobQueue] Re-queued ${stale.length} stale job(s).`);
      return stale.length;
    } catch (error) {
      logger.error("[JobQueue] Stale requeue failed:", getErrorMessage(error));
      return 0;
    }
  }

  /** Newest first — what the queue panel shows. */
  async listRecent(limit = 20): Promise<AuditJob[]> {
    try {
      const collection = await getAuditJobsCollection();
      const cursor = collection.find({}, { sort: { createdAt: -1 }, limit });
      return (await cursor.toArray()) as unknown as AuditJob[];
    } catch (error) {
      logger.error("[JobQueue] Listing failed:", getErrorMessage(error));
      return [];
    }
  }

  async stats(): Promise<Record<AuditJobStatus, number>> {
    const empty: Record<AuditJobStatus, number> = {
      QUEUED: 0,
      RUNNING: 0,
      DONE: 0,
      FAILED: 0,
      DEAD: 0,
    };

    try {
      const collection = await getAuditJobsCollection();

      await Promise.all(
        (Object.keys(empty) as AuditJobStatus[]).map(async (status) => {
          const docs = await collection.find({ status }).toArray();
          empty[status] = docs.length;
        })
      );

      return empty;
    } catch (error) {
      logger.error("[JobQueue] Stats failed:", getErrorMessage(error));
      return empty;
    }
  }

  /** Puts a DEAD/FAILED job back in the queue, retries reset. */
  async retry(jobId: string): Promise<boolean> {
    try {
      const collection = await getAuditJobsCollection();
      const now = new Date().toISOString();

      await collection.updateOne(
        { id: jobId },
        {
          $set: {
            status: "QUEUED" as AuditJobStatus,
            attempts: 0,
            workerId: null,
            lockedAt: null,
            nextAttemptAt: now,
            lastError: null,
            lastErrorCode: null,
            finishedAt: null,
            updatedAt: now,
          },
        }
      );

      logger.info(`[JobQueue] Job ${jobId} re-queued by the operator.`);
      return true;
    } catch (error) {
      logger.error(`[JobQueue] Retry failed for ${jobId}:`, getErrorMessage(error));
      return false;
    }
  }
}

export const jobQueueService = new JobQueueService();
