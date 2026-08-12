import { NextRequest, NextResponse } from "next/server";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { logger } from "@/lib/logger";

// 1x1 transparent GIF used as the tracking pixel response.
const TRANSPARENT_GIF = Buffer.from(
  "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
  "base64"
);

export async function GET(request: NextRequest) {
  const recordId = request.nextUrl.searchParams.get("r");
  if (recordId) {
    // Fire-and-forget: never let a tracking failure block the pixel response.
    await outreachPersistenceService.markOpened(recordId).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn(`[API /tracking/open] Failed to record open for ${recordId}: ${message}`);
    });
  }

  return new NextResponse(TRANSPARENT_GIF, {
    headers: {
      "Content-Type": "image/gif",
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
