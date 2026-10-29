import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { z } from "zod";
import { Business } from "@/types";
import { persistenceService } from "@/services/persistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { getBusinessesCollection } from "@/lib/db";
import { enrichmentService } from "@/services/enrichmentService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { auditEngine } from "@/services/auditService";
import { aiReportService } from "@/services/aiReportService";
import { priorityService } from "@/services/priorityService";
import { mergeNotesIntoEnrichment, parseBusinessNotes } from "@/services/notesParser";
import { applyWebsiteAuditBackfill } from "@/services/websiteAuditBackfill";
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
  force: z.boolean().optional(),
});

function normalizeWebsite(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function domainOf(url: string): string | null {
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function businessHasEmail(business: Business, email: string | null): boolean {
  if (!email) return false;
  const known = [
    business.enrichment?.preferredEmail,
    ...(business.enrichment?.emails ?? []).map((e) => e.address),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLowerCase());
  return known.includes(email);
}

/**
 * Duplicate guard: one business should exist only once. Matches an incoming
 * screenshot entry against stored businesses by website domain, normalized
 * name ("Deal's Plumbing" == "Deals Plumbing"), or the provided email.
 * Fails open (returns null) if the lookup itself errors, so creation is
 * never blocked by an infrastructure hiccup.
 */
async function findDuplicateBusiness(
  candidate: { name: string; website: string | null; email: string | null }
): Promise<Business | null> {
  try {
    const collection = await getBusinessesCollection();
    const docs = (await collection.find({}).toArray()) as unknown as Business[];
    const candidateDomain = candidate.website ? domainOf(candidate.website) : null;
    const candidateName = normalizeName(candidate.name);
    return (
      docs.find((business) => {
        if (candidateDomain) {
          const businessDomain = business.website ? domainOf(business.website) : null;
          if (businessDomain && businessDomain === candidateDomain) return true;
        }
        if (candidateName.length >= 4 && business.name && normalizeName(business.name) === candidateName) return true;
        if (businessHasEmail(business, candidate.email)) return true;
        return false;
      }) ?? null
    );
  } catch (error) {
    logger.warn(`[API /businesses/manual] Duplicate check skipped: ${getErrorMessage(error)}`);
    return null;
  }
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

    // 1b. Duplicate guard — block accidental re-creation of a business that
    // already exists (and may already have been emailed). The client can
    // retry with force:true after the user explicitly confirms.
    if (!d.force) {
      const duplicate = await findDuplicateBusiness({
        name: d.name,
        website,
        email: d.email?.toLowerCase() ?? null,
      });
      if (duplicate) {
        const existingProspect = await prospectPersistenceService.getProspectByBusinessId(duplicate.id);
        let emailCount = 0;
        let lastEmailSentAt: string | null = null;
        if (existingProspect) {
          const sentHistory = (await outreachPersistenceService.getOutreachHistory(existingProspect.id)).filter(
            (record) => record.status === "SENT"
          );
          emailCount = sentHistory.length;
          lastEmailSentAt = sentHistory.map((record) => record.sentAt).sort().at(-1) ?? null;
        }
        logger.info(`[API /businesses/manual] Duplicate blocked for "${d.name}" (existing business ${duplicate.id}).`);
        return NextResponse.json(
          {
            duplicate: true,
            match: {
              businessId: duplicate.id,
              name: duplicate.name,
              prospectId: existingProspect?.id ?? null,
              emailCount,
              lastEmailSentAt,
              suppressed: existingProspect?.isSuppressed ?? false,
            },
          },
          { status: 409 }
        );
      }
    }

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
      location: null,
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
    let enrichedBusiness: Business = { ...business, enrichment: mergedEnrichment };

    // 2b. Behind the scenes: fill in what the Google Business Profile
    // screenshot left blank (postal address, contact email) from the website
    // audit the user pasted into the notes box. Nothing is shown in the UI and
    // nothing already set is overwritten; the audit, the AI report and the
    // outreach email all read this same profile.
    enrichedBusiness = await applyWebsiteAuditBackfill(
      id,
      enrichedBusiness,
      parsedWithUserEmail
    );

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