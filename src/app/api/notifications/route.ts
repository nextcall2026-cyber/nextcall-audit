import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { notificationService } from "@/services/notificationService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { NotificationType } from "@/types";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unreadOnly") === "1";
    const limitParam = Number(searchParams.get("limit"));
    const typeParam = searchParams.get("type") as NotificationType | null;

    const [notifications, unreadCount] = await Promise.all([
      notificationService.list({
        limit:
          Number.isFinite(limitParam) && limitParam > 0 ? limitParam : undefined,
        unreadOnly,
        type: typeParam ?? undefined,
      }),
      notificationService.unreadCount(),
    ]);

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    logger.error(
      "[API /notifications] Fetch failed:",
      getErrorMessage(error)
    );

    return NextResponse.json(
      { error: "Failed to fetch notifications" },
      { status: 500 }
    );
  }
}

const PatchSchema = z.object({
  ids: z.array(z.string().min(1)).optional(),
  all: z.boolean().optional(),
});

export async function PATCH(request: NextRequest) {
  try {
    const parsed = PatchSchema.safeParse(await request.json());

    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const updated = parsed.data.all
      ? await notificationService.markAllRead()
      : await notificationService.markRead(parsed.data.ids ?? []);

    return NextResponse.json({
      updated,
      unreadCount: await notificationService.unreadCount(),
    });
  } catch (error) {
    logger.error(
      "[API /notifications] Update failed:",
      getErrorMessage(error)
    );

    return NextResponse.json(
      { error: "Failed to update notifications" },
      { status: 500 }
    );
  }
}
