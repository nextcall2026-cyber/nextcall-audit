import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Business } from "@/types";
import { persistenceService } from "@/services/persistenceService";
import { enrichmentService } from "@/services/enrichmentService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { auditEngine } from "@/services/auditService";
import { aiReportService } from "@/services/aiReportService";
import { priorityService } from "@/services/priorityService";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rateLimiter";

const ManualBusinessSchema = z.object({
  name: z.string().min(1, "Business name is required"),
  phone: z.string().trim().optional().nullable(),
  website: z.string().trim().optional().nullable(),
  address: z.string().trim().optional().nullable(),
  city: z.string().trim().optional().nullable(),
  state: z.string().trim().optional().nullable(),
  zip: z.string().trim().optional().nullable(),
  country: z.string().trim().optional().nullable(),
  rating: z.number().min(0).max(5).optional().nullable(),
  reviewCount: z.number().int().min(0).optional().nullable(),
  category: z.string().trim().optional().nullable(),
  email: z.string().trim().email("Invalid email address").optional().nullable(),
});

function normalizeWebsite(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = rateLimit(request, { intervalMs: 60000, maxRequests: 5 });
    if (rateLimitResponse) return rateLimitResponse;

    const body = await request.json();
    const parsed = ManualBusinessSchema.safeParse(body);

    if (!parsed.success) {
      logger.warn("[API /businesses/manual] Invalid request data:", parsed.error.issues);
      return NextResponse.json(
        { error: "Invalid request data", details: parsed.error.issues },
        { status: 400 }
      );
    }

    const d = parsed.data;
    const id = randomUUID();
    const website = normalizeWebsite(d.website);
    const hasLocationPart = Boolean(d.address || d.city || d.state || d.zip || d.country);

    const business: Business = {
      id,
      name: d.name,
      phone: d.phone || undefined,
      website: website || undefined,
      location: hasLocationPart
        ? {
            address: d.address || undefined,
            city: d.city || undefined,
            state: d.state || undefined,
            zip: d.zip || undefined,
            country: d.country || undefined,
          }
        : undefined,
      rating: d.rating ?? undefined,
      reviewCount: d.reviewCount ?? undefined,
      categories: d.category ? [d.category] : [],
      providerIds: { manual: id },
      status: "active",
      sources: ["MANUAL"],
      enrichment: d.email
        ? {
            status: "NOT_STARTED",
            emails: [
              {
                address: d.email,
                type: "BUSINESS" as const,
                sourceUrl: "user provided",
                sourceType: "VISIBLE_TEXT" as const,
                confidence: 100,
              },
            ],
            preferredEmail: d.email,
          }
        : undefined,
    };

    // 1. Persist the manually entered business
    await persistenceService.upsertBusiness(business);

    // 2. Run enrichment (crawls the website when one was provided)
    const enrichmentData = await enrichmentService.enrichBusiness(business);
    await persistenceService.updateEnrichmentData(id, enrichmentData);
    const enrichedBusiness: Business = { ...business, enrichment: enrichmentData };

    // 3. Run the deterministic audit + AI report
    const auditResult = await auditEngine.runAudit(enrichedBusiness);
    const auditRecord = await auditPersistenceService.saveAudit(id, auditResult);
    if (!auditRecord) {
      throw new Error("Audit record could not be saved.");
    }

    let aiReport = null;
    try {
      aiReport = await aiReportService.generateAuditReport(enrichedBusiness, auditResult);
      await auditPersistenceService.saveAIReport(auditRecord.id, aiReport);
    } catch (aiError: unknown) {
      const message = aiError instanceof Error ? aiError.message : String(aiError);
      logger.error(`[API /businesses/manual] AI report failed for ${id}: ${message}`);
    }

    // 4. Recalculate opportunity priority from the fresh audit
    await priorityService.recalculatePriorityForBusiness(id);

    logger.info(`[API /businesses/manual] Created ${d.name} (${id}) from manual input.`);

    return NextResponse.json({
      businessId: id,
      business: enrichedBusiness,
      audit: auditResult,
      aiReport,
    });
  } catch (error: any) {
    logger.error("[API /businesses/manual] Manual business creation failed:", error.message);
    return NextResponse.json(
      { error: "Failed to create business and run the audit." },
      { status: 500 }
    );
  }
}