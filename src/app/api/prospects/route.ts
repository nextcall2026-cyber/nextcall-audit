import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { persistenceService } from "@/services/persistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { opportunityService } from "@/services/opportunityService";
import { parseBusinessNotes } from "@/services/notesParser";
import { PipelineStatus } from "@/types";
import { logger } from "@/lib/logger";
import { notificationService } from "@/services/notificationService";
import { compareProspectsForPipeline } from "@/lib/pipelineSort";

import { getErrorMessage } from "@/lib/errors";
const CreateProspectSchema = z.object({
  businessId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = CreateProspectSchema.safeParse(body);

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

    const business =
      await persistenceService.getBusinessById(businessId);

    if (!business) {
      return NextResponse.json(
        { error: "Business not found" },
        { status: 404 }
      );
    }

    // Determine best contact email: the user-verified preferred address
    // first, then any discovered email, then an address stated in the
    // business notes (e.g. entered during the screenshot flow).
    const contactEmail =
      business.enrichment?.preferredEmail ||
      business.enrichment?.emails?.[0]?.address ||
      (business.notes ? parseBusinessNotes(business.notes).emails[0]?.address : null) ||
      null;

    // Calculate Opportunity Score at add time
    const opportunityScore = opportunityService.calculateScore(business);

    const prospect =
      await prospectPersistenceService.createProspect(
        businessId,
        contactEmail,
        opportunityScore,
        business
      );

    if (!prospect) {
      throw new Error("Failed to create prospect.");
    }

    // In-app feed: a new prospect is the moment the pipeline list changes.
    await notificationService.notify({
      type: "PROSPECT_ADDED",
      title: `New prospect: ${business.name}`,
      body: contactEmail
        ? `Added to the pipeline · ${contactEmail}`
        : "Added to the pipeline — no contact email detected yet",
      href: `/dashboard/pipeline/${prospect.id}`,
      prospectId: prospect.id,
      businessId,
      dedupeKey: `prospect-added:${prospect.id}`,
    });

    return NextResponse.json({ prospect });
  } catch (error) {
    logger.error(
      "[API /prospects] Creation failed:",
      getErrorMessage(error)
    );

    return NextResponse.json(
      { error: "Failed to create prospect" },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const status =
      searchParams.get("status") as PipelineStatus | null;

    const prospects =
      await prospectPersistenceService.getAllProspects(
        status || undefined
      );

    // Canonical pipeline order lives in lib/pipelineSort.ts and is shared
    // with the client, so optimistic cache patches keep the exact same order.
    const sortedProspects = prospects.sort(compareProspectsForPipeline);

    // Enrich prospects with business name and audit score for the UI list
    const enrichedProspects = await Promise.all(
      sortedProspects.map(async (p) => {
        const business =
          await persistenceService.getBusinessById(
            p.businessId
          );

        const latestAudit =
          await auditPersistenceService.getLatestAudit(
            p.businessId
          );

        return {
          ...p,
          businessName:
            business?.name || p.businessSnapshot?.name || "Unknown Business",
          auditScore:
            latestAudit?.audit.overallScore || null,
        };
      })
    );

    return NextResponse.json({
      prospects: enrichedProspects,
    });
  } catch (error) {
    logger.error(
      "[API /prospects] Fetch failed:",
      getErrorMessage(error)
    );

    return NextResponse.json(
      { error: "Failed to fetch prospects" },
      { status: 500 }
    );
  }
}