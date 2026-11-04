import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getScreenshotUploadsCollection } from "@/lib/db";
import { jobQueueService } from "@/services/jobQueueService";
import { warmRouterInBackground } from "@/lib/ai/warmup";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rateLimiter";
import { getErrorMessage } from "@/lib/errors";

/**
 * Ingest: two screenshots in, one instantly-queued job out.
 *
 * ZERO AI on this path — the operator queues as fast as they can paste. Both
 * images are stored (base64, compressed by the browser first) and handed to
 * the audit worker, which reads them with the one shared AI chain, creates the
 * business, runs the duplicate check and then the whole audit pipeline. The
 * uploads are deleted as soon as the read has turned them into a business, so
 * there is no blob storage bill and nothing left to clean up but strays.
 */

const MAX_STORED_BYTES = 6 * 1024 * 1024; // per image, after browser compression

export async function POST(request: NextRequest) {
  try {
    // Generous: the operator may queue many businesses in a row.
    const rateLimitResponse = rateLimit(request, { intervalMs: 60_000, maxRequests: 20 });
    if (rateLimitResponse) return rateLimitResponse;

    // The router sleeps when idle and takes 60-95s to wake. Nudge it now so
    // the worker's vision read (a minute away) finds it awake.
    warmRouterInBackground();

    const formData = await request.formData().catch(() => null);
    const googleFile = formData?.get("google");
    const facebookFile = formData?.get("facebook");

    if (!(googleFile instanceof File)) {
      return NextResponse.json(
        { error: "Add a screenshot of the Google Business Profile first." },
        { status: 400 }
      );
    }
    for (const file of [googleFile, facebookFile]) {
      if (file instanceof File) {
        if (!file.type.startsWith("image/")) {
          return NextResponse.json(
            { error: "That file is not an image. Use a PNG, JPG or WEBP screenshot." },
            { status: 400 }
          );
        }
        if (file.size > MAX_STORED_BYTES) {
          return NextResponse.json(
            {
              error: `The ${file === googleFile ? "Google" : "Facebook"} screenshot is larger than 6 MB. Paste a smaller or clearer screenshot.`,
            },
            { status: 400 }
          );
        }
      }
    }

    const collection = await getScreenshotUploadsCollection();
    const googleId = randomUUID();
    const facebookId = facebookFile instanceof File ? randomUUID() : null;

    const now = new Date().toISOString();
    const uploads: Array<{
      id: string;
      kind: "google" | "facebook";
      mimeType: string;
      dataBase64: string;
      bytes: number;
      createdAt: string;
    }> = [
      {
        id: googleId,
        kind: "google" as const,
        mimeType: googleFile.type,
        dataBase64: Buffer.from(await googleFile.arrayBuffer()).toString("base64"),
        bytes: googleFile.size,
        createdAt: now,
      },
    ];
    if (facebookFile instanceof File && facebookId) {
      uploads.push({
        id: facebookId,
        kind: "facebook" as const,
        mimeType: facebookFile.type,
        dataBase64: Buffer.from(await facebookFile.arrayBuffer()).toString("base64"),
        bytes: facebookFile.size,
        createdAt: now,
      });
    }

    await collection.insertMany(uploads);

    const job = await jobQueueService.enqueue({
      screenshots: { googleId, facebookId },
    });

    if (!job) {
      return NextResponse.json(
        {
          error:
            "The screenshots were stored, but they could not be added to the queue. Please try again.",
        },
        { status: 500 }
      );
    }

    logger.info(
      `[API /businesses/manual] Queued screenshots (${uploads.length} image(s)) as job ${job.id} — no AI at queue time.`
    );

    return NextResponse.json({
      queued: true,
      jobId: job.id,
      hasFacebook: Boolean(facebookId),
    });
  } catch (error) {
    logger.error("[API /businesses/manual] Ingest failed:", getErrorMessage(error));
    return NextResponse.json(
      { error: "Something went wrong while queueing the screenshots. Please try again." },
      { status: 500 }
    );
  }
}
