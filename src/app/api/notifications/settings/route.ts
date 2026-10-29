import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { notificationService } from "@/services/notificationService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

export async function GET() {
  try {
    const settings = await notificationService.getSettings();
    return NextResponse.json({ settings });
  } catch (error) {
    logger.error(
      "[API /notifications/settings] Fetch failed:",
      getErrorMessage(error)
    );

    return NextResponse.json(
      { error: "Failed to fetch notification settings", details: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

const SettingsPatchSchema = z.object({
  enabled: z.record(z.string(), z.boolean()).optional(),
  quietHoursEnabled: z.boolean().optional(),
  quietStartHour: z.number().int().min(0).max(23).optional(),
  quietEndHour: z.number().int().min(0).max(23).optional(),
  timezone: z.string().min(1).optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    const parsed = SettingsPatchSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const settings = await notificationService.updateSettings(parsed.data);
    return NextResponse.json({ settings });
  } catch (error) {
    logger.error(
      "[API /notifications/settings] Update failed:",
      getErrorMessage(error)
    );

    return NextResponse.json(
      { error: "Failed to update notification settings", details: getErrorMessage(error) },
      { status: 500 }
    );
  }
}
