import { NextRequest, NextResponse } from "next/server";
import {
  ENGINE_LIVE_TTL_MS,
  EngineState,
  engineLiveReason,
  engineStateService,
} from "@/services/engineStateService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * The engine switch API — status, toggle and the dashboard heartbeat.
 *
 * The middleware already requires the auth cookie on every /api path, so every
 * caller here is the signed-in operator. Scheduled callers never come here:
 * they check the engine through engineStateService.isAutomationLive().
 *
 *   GET  /api/engine                  → current status (+ TTL for the UI)
 *   POST /api/engine {action:"on"}    → ENGINE ON (counts as first heartbeat)
 *   POST /api/engine {action:"off"}   → ENGINE OFF (operator pressed the switch)
 *   POST /api/engine {action:"heartbeat"} → keep-alive while working
 */

async function statusPayload() {
  const state: EngineState = await engineStateService.getState();
  const now = Date.now();
  const reason = engineLiveReason(state, now);

  return {
    ttlMs: ENGINE_LIVE_TTL_MS,
    engine: {
      on: state.on,
      live: reason === "on",
      reason,
      lastHeartbeatAt: state.lastHeartbeatAt,
      lastOffAt: state.lastOffAt,
      lastOffReason: state.lastOffReason,
    },
  };
}

export async function GET() {
  try {
    return NextResponse.json(await statusPayload());
  } catch (error) {
    logger.error("[API /engine] Status failed:", getErrorMessage(error));
    return NextResponse.json({ error: "Engine status failed" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { action?: string } | null;
  const action = body?.action;

  if (action !== "on" && action !== "off" && action !== "heartbeat") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  try {
    if (action === "on") await engineStateService.turnOn();
    if (action === "off") await engineStateService.turnOff("operator");
    if (action === "heartbeat") await engineStateService.heartbeat();

    return NextResponse.json(await statusPayload());
  } catch (error) {
    logger.error(`[API /engine] ${action} failed:`, getErrorMessage(error));
    return NextResponse.json({ error: "Engine switch failed" }, { status: 500 });
  }
}
