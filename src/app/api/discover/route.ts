import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { discoveryService } from "@/services/discoveryService";
import { persistenceService } from "@/services/persistenceService";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rateLimiter";

import { getErrorMessage } from "@/lib/errors";
const DiscoverRequestSchema = z.object({
  query: z.string().min(1, "Search query is required"),
  boundingBox: z.object({
    minLat: z.number(),
    minLng: z.number(),
    maxLat: z.number(),
    maxLng: z.number(),
  }),
  targetResults: z.number().min(1).max(200).optional().default(50),
});

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = rateLimit(request, { intervalMs: 60000, maxRequests: 5 });
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();

    const parsed = DiscoverRequestSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn("[API /discover] Invalid request data:", parsed.error.issues);
      return NextResponse.json(
        { error: "Invalid request data", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const { query, boundingBox, targetResults } = parsed.data;

    const businesses = await discoveryService.discoverBusinesses({ query, boundingBox }, targetResults);

    await persistenceService.saveBusinesses(businesses);

    return NextResponse.json({ businesses });

  } catch (error) {
    logger.error("[API /discover] Discovery failed:", getErrorMessage(error));

    return NextResponse.json(
      {
        error: "Failed to discover businesses. Please try again later.",
      },
      { status: 500 }
    );
  }
}
