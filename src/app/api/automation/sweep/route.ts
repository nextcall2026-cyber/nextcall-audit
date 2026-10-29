import { NextRequest, NextResponse } from "next/server";
import { runAutomationSweep, parseSweepParts, SweepParts } from "@/services/automationSweepService";
import { authorizeSweep } from "@/lib/sweepAuth";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * Automation heartbeat.
 *
 * Vercel Hobby crons only run once a day, so this is meant to be called every
 * 15 minutes. Two callers are supported:
 *
 *   GET https://<app>/api/automation/sweep   header: x-cron-secret=<CRON_SECRET>
 *   (or ?secret=<CRON_SECRET> when headers are not configurable)
 *
 *   POST /api/automation/sweep  — from the dashboard ("Run now"), authorised by
 *   the normal auth cookie the middleware already validates.
 *
 * One pass does everything that has to happen on a schedule:
 *   1. follow-up sweep (3-day / 7-day sequence)
 *   2. auto-send pass for brand-new prospects
 *   3. daily digest notification
 *   4. notification housekeeping (30-day prune)
 */
async function handleSweep(request: NextRequest) {
  const auth = authorizeSweep({
    headerSecret: request.headers.get("x-cron-secret"),
    querySecret: request.nextUrl.searchParams.get("secret"),
    authCookie: request.cookies.get("nextcall_auth")?.value ?? null,
    cronSecret: process.env.CRON_SECRET,
    appPassword: process.env.APP_PASSWORD,
  });

  if (!auth.ok) {
    logger.warn(`[API /automation/sweep] Rejected: ${auth.reason}`);
    return NextResponse.json({ error: "Unauthorized", reason: auth.reason }, { status: 401 });
  }

  try {
    // Optional narrowing, e.g. ?parts=autoSend to flush the initial-email
    // backlog without touching the follow-up sequence.
    const parts = {
      followUps: true,
      autoSend: true,
      digest: true,
      prune: true,
      ...parseSweepParts(request.nextUrl.searchParams.get("parts")),
    } satisfies SweepParts;

    const result = await runAutomationSweep(parts);
    return NextResponse.json(
      { ...result, triggeredBy: auth.via },
      { status: result.ok ? 200 : 500 }
    );
  } catch (error) {
    logger.error("[API /automation/sweep] Failed:", getErrorMessage(error));
    return NextResponse.json({ error: "Sweep failed" }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleSweep(request);
}

export async function POST(request: NextRequest) {
  return handleSweep(request);
}