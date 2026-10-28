import { NextRequest, NextResponse } from "next/server";
import { followUpAutomationService } from "@/services/followUpAutomationService";
import { autoSendService } from "@/services/autoSendService";
import { dailyDigestService } from "@/services/dailyDigestService";
import { notificationService } from "@/services/notificationService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * Automation heartbeat.
 *
 * Vercel Hobby crons only run once a day, so this is meant to be called from
 * an external scheduler (cron-job.org / UptimeRobot) every 15 minutes with
 * the shared secret:
 *
 *   GET https://<app>/api/automation/sweep   header: x-cron-secret: <CRON_SECRET>
 *   (or ?secret=<CRON_SECRET> when headers are not configurable)
 *
 * One pass does everything that has to happen on a schedule:
 *   1. follow-up sweep (3-day / 7-day sequence)
 *   2. auto-send pass for brand-new prospects
 *   3. daily digest notification
 *   4. notification housekeeping (30-day prune)
 */
async function handleSweep(request: NextRequest) {
  const provided =
    request.headers.get("x-cron-secret") ??
    request.nextUrl.searchParams.get("secret");

  if (!process.env.CRON_SECRET || provided !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    await followUpAutomationService.runSweep();
    const autoSend = await autoSendService.runPass();
    const digest = await dailyDigestService.maybeSendDigest();
    const pruned = await notificationService.prune(30);

    return NextResponse.json({
      ok: true,
      autoSend,
      digest,
      prunedNotifications: pruned,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    logger.error("[API /automation/sweep] Failed:", getErrorMessage(error));

    await notificationService.notify({
      type: "AUTOMATION_ISSUE",
      title: "Automation sweep failed",
      body: getErrorMessage(error).slice(0, 300),
      dedupeKey: "automation-sweep-failed",
    });

    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleSweep(request);
}

export async function POST(request: NextRequest) {
  return handleSweep(request);
}
