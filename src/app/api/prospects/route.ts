import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { persistenceService } from "@/services/persistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { opportunityService } from "@/services/opportunityService";
import { parseBusinessNotes } from "@/services/notesParser";
import { PipelineStatus } from "@/types";
import { logger } from "@/lib/logger";

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

    // Pipeline order: prospects whose audit was never opened ("New",
    // viewAddedAt is null) go to the very top — newest additions first —
    // while opened ones sink to the bottom, still ranked by priorityScore
    // descending (nulls last) within that group.
    const sortedProspects = prospects.sort((a, b) => {
      const aUnread = !a.viewAddedAt;
      const bUnread = !b.viewAddedAt;
      if (aUnread !== bUnread) return aUnread ? -1 : 1;

      if (aUnread) {
        return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      }

      const scoreA = a.priorityScore || -1;
      const scoreB = b.priorityScore || -1;
      if (scoreA !== scoreB) return scoreB - scoreA;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

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