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
import { mergeNotesIntoEnrichment, parseBusinessNotes } from "@/services/notesParser";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rateLimiter";

import { getErrorMessage } from "@/lib/errors";
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
  notes: z.string().trim().optional().nullable(),
});

function normalizeWebsite(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/**
 * Merges user-provided signals from the notes box into the enrichment
 * result AFTER the website crawl, so anything the user verified manually
 * (socials, booking, email) is scored by the audit even if the crawl
 * missed it. Crawl findings are never overwritten.
 * (Implementation lives in notesParser.ts so the /api/audit pipeline can
 * apply the exact same merge to prospect notes.)
 */

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
    const notesItem = d.notes ? parseBusinessNotes(d.notes) : null;
    // A website pasted in the notes can still feed the crawl if the field was empty
    const website = normalizeWebsite(d.website) ?? notesItem?.website ?? null;
    const hasLocationPart = Boolean(d.address || d.city || d.state || d.zip || d.country);

    const business: Business = {
      id,
      name: d.name,
      phone: d.phone || notesItem?.phone || undefined,
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
      // Raw notes are stored so the AI report prompt can quote them as
      // owner-verified context.
      notes: d.notes || undefined,
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

    // 2. Run enrichment (crawls the website when one was provided), then merge
    //    the user-verified signals on top of the crawl data. enrichBusiness
    //    builds a fresh enrichment object from the crawl, so the email typed
    //    in the dedicated Email field must be re-applied here — otherwise it
    //    is lost before the prospect (and its Contact Email) is created.
    const enrichmentData = await enrichmentService.enrichBusiness(business);
    const userEmail = d.email ? d.email.toLowerCase() : null;
    const parsedFromNotes = notesItem ?? {
      socialProfiles: [],
      booking: null,
      emails: [],
      phone: null,
      website: null,
      mentionsContactForm: false,
    };
    const parsedWithUserEmail = userEmail
      ? {
          ...parsedFromNotes,
          emails: [
            {
              address: userEmail,
              type: "BUSINESS" as const,
              sourceUrl: "user provided",
              sourceType: "VISIBLE_TEXT" as const,
              confidence: 100,
            },
            ...parsedFromNotes.emails.filter((e) => e.address !== userEmail),
          ],
        }
      : parsedFromNotes;
    const mergedEnrichment = mergeNotesIntoEnrichment(enrichmentData, parsedWithUserEmail);
    // The explicitly typed address outranks anything the crawl guessed.
    if (userEmail) {
      mergedEnrichment.preferredEmail = userEmail;
    }
    await persistenceService.updateEnrichmentData(id, mergedEnrichment);
    const enrichedBusiness: Business = { ...business, enrichment: mergedEnrichment };

    // 3. Run the deterministic audit + AI report
    const auditResult = await auditEngine.runAudit(enrichedBusiness);
    const auditRecord = await auditPersistenceService.saveAudit(id, auditResult);
    if (!auditRecord) {
      throw new Error("Audit record could not be saved.");
    }

    let aiReport = null;
    let aiWarning: string | null = null;
    try {
      aiReport = await aiReportService.generateAuditReport(enrichedBusiness, auditResult);
      await auditPersistenceService.saveAIReport(auditRecord.id, aiReport);
    } catch (aiError: unknown) {
      const message = aiError instanceof Error ? aiError.message : String(aiError);
      logger.error(`[API /businesses/manual] AI report failed for ${id}: ${message}`);
      aiWarning = `AI report generation failed: ${message}. The business and deterministic audit were created — you can Re-run Audit later.`;
    }

    // 4. Recalculate opportunity priority from the fresh audit
    await priorityService.recalculatePriorityForBusiness(id);

    logger.info(`[API /businesses/manual] Created ${d.name} (${id}) from manual input.`);

    return NextResponse.json({
      businessId: id,
      business: enrichedBusiness,
      audit: auditResult,
      aiReport,
      warning: aiWarning,
    });
  } catch (error) {
    logger.error("[API /businesses/manual] Manual business creation failed:", getErrorMessage(error));
    return NextResponse.json(
      { error: "Failed to create business and run the audit." },
      { status: 500 }
    );
  }
}