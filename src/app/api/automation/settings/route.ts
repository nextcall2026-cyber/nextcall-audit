import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { automationSettingsService } from "@/services/automationSettingsService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

export async function GET() {
  try {
    const settings = await automationSettingsService.getSettings();
    return NextResponse.json({ settings });
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
    return NextResponse.json({ settings });
  } catch (error) {
    logger.error("[API /automation/settings] Update failed:", getErrorMessage(error));
    return NextResponse.json(
      { error: "Failed to update automation settings", details: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
