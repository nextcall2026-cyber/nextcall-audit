import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { persistenceService } from "@/services/persistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { logger } from "@/lib/logger";

// 1. Define the Schema at the top level
const UpdateProspectSchema = z.object({
  status: z.enum(["NEW", "READY_TO_CONTACT", "CONTACTED", "FOLLOW_UP", "QUALIFIED", "CONVERTED", "UNQUALIFIED", "CLOSED_LOST"]).optional(),
  priority: z.enum(["HIGH", "MEDIUM", "LOW"]).optional(),
  nextFollowUpAt: z.string().nullable().optional(),
  noteText: z.string().optional(),
  isSuppressed: z.boolean().optional(),             
  suppressionReason: z.string().nullable().optional(),
  contactEmail: z.string().email("Invalid email address").nullable().optional()
});

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Next.js 16: route params are asynchronous
    const { id } = await params;

    const prospect = await prospectPersistenceService.getProspectById(id);

    if (!prospect) {
      return NextResponse.json(
        { error: "Prospect not found" },
        { status: 404 }
      );
    }

    let business = await persistenceService.getBusinessById(prospect.businessId);
    if (!business && prospect.businessSnapshot) {
      // Reconstruct from snapshot if business document was removed
      const snap = prospect.businessSnapshot;
      business = {
        id: prospect.businessId,
        name: snap.name || "Unknown Business",
        phone: snap.phone || undefined,
        website: snap.website || undefined,
        location: snap.location || undefined,
        rating: snap.rating ?? undefined,
        reviewCount: snap.reviewCount ?? undefined,
        categories: snap.categories || undefined,
        sources: snap.sources,
        sourceProviders: snap.sourceProviders || undefined,
        providerIds: {},
        enrichment: snap.enrichmentStatus ? {
          status: snap.enrichmentStatus,
          completedAt: snap.enrichmentCompletedAt || undefined,
          preferredEmail: snap.preferredEmail || undefined,
          emails: snap.emails?.map(a => ({ address: a, type: 'UNKNOWN' as const, sourceUrl: '', sourceType: 'VISIBLE_TEXT' as const, confidence: 0 })) || undefined,
          booking: snap.bookingDetected ? { detected: true, url: snap.bookingUrl || undefined } : undefined,
          socialProfiles: snap.socialPlatforms?.map(p => ({ platform: p as any, url: '', sourceUrl: '', confidence: 0 })) || undefined,
          crawlMetadata: snap.crawlQuality ? { crawlQuality: snap.crawlQuality as any, pagesAttempted: 0, pagesSuccessful: 0, pagesFailed: 0, pagesVisited: [], renderingRequired: false, crawlDurationMs: 0 } : undefined,
        } : undefined,
      };
    } else if (!business) {
      business = {
        id: prospect.businessId,
        name: "Business data unavailable",
        sources: [],
        providerIds: {},
      };
    }
    const latestAudit = await auditPersistenceService.getLatestAudit(prospect.businessId);
    const outreachHistory = await outreachPersistenceService.getOutreachHistory(prospect.id);

    return NextResponse.json({
      prospect,
      business,
      audit: latestAudit?.audit || null,
      aiReport: latestAudit?.aiReport || null,
      outreachHistory,
    });
  } catch (error: any) {
    logger.error("[API /prospects/[id]] Fetch failed:", error.message);
    return NextResponse.json(
      { error: "Failed to fetch prospect details" },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Next.js 16: route params are asynchronous
    const { id } = await params;
    
    const body = await request.json();
    const parsed = UpdateProspectSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { status, priority, nextFollowUpAt, noteText, isSuppressed, suppressionReason, contactEmail } = parsed.data;

    // Empty PATCH body signals "mark as viewed"
    if (!status && !priority && !noteText && isSuppressed === undefined && contactEmail === undefined) {
      await prospectPersistenceService.markAsViewed(id);
    }

    if (status) await prospectPersistenceService.updateStatus(id, status);
    if (priority) await prospectPersistenceService.updatePriority(id, null, priority, null);
    if (nextFollowUpAt !== undefined) await prospectPersistenceService.setNextFollowUp(id, nextFollowUpAt);
    if (noteText) await prospectPersistenceService.addNote(id, noteText);
    if (contactEmail !== undefined) await prospectPersistenceService.updateContactEmail(id, contactEmail);
    
    // Handle suppression update
    if (isSuppressed !== undefined) {
      await prospectPersistenceService.updateSuppression(id, isSuppressed, suppressionReason || null);
    }

    const updatedProspect = await prospectPersistenceService.getProspectById(id);
    return NextResponse.json({ prospect: updatedProspect });

  } catch (error: any) {
    logger.error("[API /prospects/[id]] Update failed:", error.message);
    return NextResponse.json({ error: "Failed to update prospect" }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const prospect = await prospectPersistenceService.getProspectById(id);
    if (!prospect) {
      return NextResponse.json({ error: "Prospect not found" }, { status: 404 });
    }

    // Delete the prospect plus everything tied to it: outreach history,
    // audit records, and the business document itself.
    await prospectPersistenceService.deleteProspect(id);
    await outreachPersistenceService.deleteOutreachForProspect(id);
    await auditPersistenceService.deleteAuditsForBusiness(prospect.businessId);
    await persistenceService.deleteBusiness(prospect.businessId);

    logger.info(`[API /prospects/[id]] Deleted prospect ${id} (business ${prospect.businessId}).`);

    return NextResponse.json({ deleted: true });
  } catch (error: any) {
    logger.error("[API /prospects/[id]] Delete failed:", error.message);
    return NextResponse.json({ error: "Failed to delete prospect" }, { status: 500 });
  }
}