import { NextRequest, NextResponse } from "next/server";
import { autoSendService } from "@/services/autoSendService";
import { automationSettingsService } from "@/services/automationSettingsService";
import {
  automationRunLogService,
  isPassDue,
  PASS_INTERVAL_MS,
} from "@/services/automationRunLogService";
import { authorizeSweep } from "@/lib/sweepAuth";
import { engineStateService } from "@/services/engineStateService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/** A pass sends real emails; give it room to finish inside one invocation. */
export const maxDuration = 60;

/**
 * Automatic sending, driven by whichever request arrives first.
 *
 * There is no always-on scheduler on a serverless host, so the dashboard
 * heartbeat (and the daily cron) call this endpoint. It runs the auto-send
 * pass when at least 15 minutes have passed since the last one — or when an
 * authenticated cron caller explicitly asks with `?force=1`.
 */
async function handleTick(request: NextRequest) {
  const auth = authorizeSweep({
    headerSecret: request.headers.get("x-cron-secret"),
    querySecret: request.nextUrl.searchParams.get("secret"),
    authorizationHeader: request.headers.get("authorization"),
    authCookie: request.cookies.get("nextcall_auth")?.value ?? null,
    cronSecret: process.env.CRON_SECRET,
    appPassword: process.env.APP_PASSWORD,
  });

  if (!auth.ok) {
    return NextResponse.json({ error: "Unauthorized", reason: auth.reason }, { status: 401 });
  }

  try {
    // The engine gate: nothing auto-sends while the engine is OFF — not the
    // external cron, not even the dashboard heartbeat. Explicit operator
    // actions (uploads, "Run now") do not come through here.
    const engine = await engineStateService.isAutomationLive();
    if (!engine.live) {
      return NextResponse.json({
        ran: false,
        reason: `engine off (${engine.reason})`,
      });
    }

    const settings = await automationSettingsService.getSettings();

    if (!settings.autoSendEnabled) {
      return NextResponse.json({ ran: false, reason: "auto-send is off" });
    }

    const forced = request.nextUrl.searchParams.get("force") === "1";
    const state = await automationRunLogService.getState();

    if (!forced && !isPassDue(state.lastRunAt, Date.now())) {
      return NextResponse.json({
        ran: false,
        reason: "next pass not due yet",
        lastRunAt: state.lastRunAt,
        intervalMs: PASS_INTERVAL_MS,
      });
    }

    const report = await autoSendService.runPass();

    await automationRunLogService.markRun(
      report.dryRun
        ? `test mode — ${report.candidates} would be emailed`
        : `${report.sent} sent of ${report.candidates} waiting${report.skipped ? ` (${report.skipped})` : ""}`
    );

    logger.info(
      `[API /automation/tick] Pass by ${auth.via}: ${report.sent} sent, ${report.candidates} candidate(s), skipped: ${report.skipped || "-"}`
    );

    return NextResponse.json({ ran: true, triggeredBy: auth.via, autoSend: report });
  } catch (error) {
    logger.error("[API /automation/tick] Failed:", getErrorMessage(error));
    return NextResponse.json({ error: "Tick failed", details: getErrorMessage(error) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  return handleTick(request);
}

export async function GET(request: NextRequest) {
  return handleTick(request);
}