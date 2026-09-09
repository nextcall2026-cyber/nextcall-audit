import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { persistenceService } from "@/services/persistenceService";
import { enrichmentService } from "@/services/enrichmentService";
import { logger } from "@/lib/logger";
import { priorityService } from "@/services/priorityService";
import { rateLimit } from "@/lib/rateLimiter";

import { getErrorMessage } from "@/lib/errors";
const EnrichRequestSchema = z.object({
  businessId: z.string().min(1, "Business ID is required"),
  business: z.any().optional(),
});

export async function POST(request: NextRequest) {
  try {
    // Rate Limit: 5 requests per minute
    const rateLimitResponse = rateLimit(request, { intervalMs: 60000, maxRequests: 5 });
    if (rateLimitResponse) return rateLimitResponse;
    const body = await request.json();
    const parsed = EnrichRequestSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { businessId } = parsed.data;

    // 1. Load Business from DB
    let business = await persistenceService.getBusinessById(businessId);

    if (!business && parsed.data.business) {
      // Business wasn't persisted (e.g. DB was hibernating during discovery).
      // Persist the copy the client already has so enrichment can proceed.
      await persistenceService.upsertBusiness(parsed.data.business);
      business = await persistenceService.getBusinessById(businessId);
    }

    if (!business) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      );
    }

    // 2. Caching check: If enrichment was completed recently, return cached data
    // 30 days = 30 * 24 * 60 * 60 * 1000 milliseconds
    const thirtyDaysMs = 2592000000;

    if (
      business.enrichment?.status === "COMPLETED" &&
      business.enrichment.completedAt &&
      Date.now() - new Date(business.enrichment.completedAt).getTime() <
        thirtyDaysMs
    ) {
      logger.info(
        `[API /enrich] Returning cached enrichment for ${businessId}`
      );

      return NextResponse.json({ business });
    }

    // 5. Run Enrichment Pipeline
    const enrichmentData = await enrichmentService.enrichBusiness(business);

    // 4. Persist Enrichment Data back to Astra DB
    await persistenceService.updateEnrichmentData(businessId, enrichmentData);

    // 5. Return updated business to client
    const updatedBusiness = { ...business, enrichment: enrichmentData };
    
    // NEW: Recalculate Priority Score because enrichment data changed
    await priorityService.recalculatePriorityForBusiness(businessId);

    return NextResponse.json({
      business: updatedBusiness,
    });
  } catch (error) {
    logger.error(
      "[API /enrich] Enrichment failed:",
      getErrorMessage(error)
    );

    const message = getErrorMessage(error) ?? "";
    const isDbUnavailable =
      message.includes("resuming from hibernation") ||
      message.toLowerCase().includes("hibernat") ||
      message.includes("Astra DB is not configured");

    return NextResponse.json(
      {
        error: isDbUnavailable
          ? "Our database is waking up from hibernation. Please wait a minute and try again."
          : "Failed to enrich business.",
      },
      { status: isDbUnavailable ? 503 : 500 }
    );
  }
}