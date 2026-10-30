import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  automationSettingsService,
  startOfDayIso,
} from "@/services/automationSettingsService";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { automationRunLogService } from "@/services/automationRunLogService";
import { MAX_SENDS_PER_PASS } from "@/services/autoSendService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * How much of today's allowance has been used. Counted from real SENT outreach
 * records (initial emails + follow-ups), from local midnight in the configured
 * timezone — the same window the send cap uses.
 */
async function usageFor(settings: { timezone: string; dailyCap: number }) {
  const dayStart = startOfDayIso(settings.timezone);
  const counts = await outreachPersistenceService.countSentSinceByStage(dayStart);
  const runState = await automationRunLogService.getState();
  return {
    sentToday: counts.total,
    initialEmails: counts.initial,
    followUps: counts.followUps,
    dailyCap: settings.dailyCap,
    timezone: settings.timezone,
    dayStart,
    lastRunAt: runState.lastRunAt,
    lastRunResult: runState.lastResult,
    perPassLimit: MAX_SENDS_PER_PASS,
  };
}

export async function GET() {
  try {
    const settings = await automationSettingsService.getSettings();
    const usage = await usageFor(settings);
    return NextResponse.json({ settings, usage });
  } catch (error) {
    logger.error("[API /automation/settings] Fetch failed:", getErrorMessage(error));
    return NextResponse.json(
      { error: "Failed to fetch automation settings", details: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

const AutomationSettingsSchema = z.object({
  autoSendEnabled: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  dailyCap: z.number().int().min(0).max(100).optional(),
  businessHoursEnabled: z.boolean().optional(),
  startHour: z.number().int().min(0).max(23).optional(),
  endHour: z.number().int().min(0).max(23).optional(),
  timezone: z.string().min(1).optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    const parsed = AutomationSettingsSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const settings = await automationSettingsService.updateSettings(parsed.data);
    const usage = await usageFor(settings);
    return NextResponse.json({ settings, usage });
  } catch (error) {
    logger.error("[API /automation/settings] Update failed:", getErrorMessage(error));
    return NextResponse.json(
      { error: "Failed to update automation settings", details: getErrorMessage(error) },
      { status: 500 }
    );
  }
}