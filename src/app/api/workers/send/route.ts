import { NextRequest, NextResponse, after } from "next/server";
import { env } from "@/lib/env";
import { authorizeSweep } from "@/lib/sweepAuth";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { autoSendService, AutoSendReport } from "@/services/autoSendService";
import { automationRunLogService } from "@/services/automationRunLogService";
import { engineStateService } from "@/services/engineStateService";

/**
 * The send worker — exactly ONE email per invocation.
 *
 * Triggered by an external scheduler (cron-job.org) every 2 minutes:
 *   POST /api/workers/send
 *   x-cron-secret=<CRON_SECRET>
 *
 * The 2-minute cadence IS the pacing, so this endpoint deliberately skips the
 * 15-minute pass gate the dashboard heartbeat uses. Every other guard inside
 * autoSendService still applies: auto-send on/off, test mode, business hours,
 * the hard daily cap, one-business-one-email and the per-provider daily
 * quotas. The run log is stamped on every pass, so the heartbeat and the
 * daily sweep can never double-send on top of this worker.
 *
 * The response is sent IMMEDIATELY (202) and the pass runs in `after()` —
 * the same pattern as the audit worker, so a 30-second scheduler timeout
 * cannot cut a send (and its PDF render) short.
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function runSendPass(): Promise<AutoSendReport> {
  // Minimum gap between send passes: the audit worker chains this pass every
  // minute, and an external send cron may fire too — never send twice within
  // one minute. Skipped silently (no run-log stamp), so the gap stays honest.
  const state = await automationRunLogService.getState();
  if (state.lastRunAt && Date.now() - new Date(state.lastRunAt).getTime() < 60_000) {
    return { ran: false, dryRun: false, candidates: 0, sent: 0, skipped: "ran less than a minute ago" };
  }

  const report = await autoSendService.runPass();

  await automationRunLogService.markRun(
    report.ran
      ? report.dryRun
        ? `test mode — ${report.candidates} would be emailed`
        : `${report.sent} sent of ${report.candidates} waiting${report.skipped ? ` (${report.skipped})` : ""}`
      : `not run: ${report.skipped || "auto-send is off"}`
  );

  logger.info(
    `[Worker /send] Pass done — ${report.sent} sent, candidates ${report.candidates}, skipped: ${report.skipped || "-"}`
  );

  return report;
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
    logger.warn(`[Worker /send] Rejected: ${auth.reason}`);
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // The engine gate: a scheduled caller only sends while the operator's engine
  // is ON and freshly heartbeated. Manual ?wait=1 tests bypass the gate — an
  // operator pressing a button is a deliberate action.
  if (auth.via === "cron-secret") {
    const engine = await engineStateService.isAutomationLive();
    if (!engine.live) {
      logger.info(`[Worker /send] Engine off (${engine.reason}) — pass skipped.`);
      return NextResponse.json(
        { accepted: false, engine: "off", reason: engine.reason },
        { status: 200 }
      );
    }
  }

  const wantsToWait = new URL(request.url).searchParams.get("wait") === "1";

  // Manual test: answer with the real report.
  if (wantsToWait) {
    try {
      const report = await runSendPass();
      return NextResponse.json({ ok: true, report });
    } catch (error) {
      logger.error("[Worker /send] Pass crashed:", getErrorMessage(error));
      return NextResponse.json({ error: "Send pass failed." }, { status: 500 });
    }
  }

  // Scheduler: hang up now, keep working.
  after(async () => {
    try {
      await runSendPass();
    } catch (error) {
      logger.error("[Worker /send] Background pass crashed:", getErrorMessage(error));
    }
  });

  return NextResponse.json({ accepted: true, worker: "send" }, { status: 202 });
}

/** A GET is handy for uptime checkers and for eyeballing the endpoint. */
export async function GET() {
  const state = await automationRunLogService.getState();
  return NextResponse.json({ worker: "send", ...state });
}
