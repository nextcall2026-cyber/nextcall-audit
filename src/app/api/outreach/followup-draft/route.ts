import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { persistenceService } from "@/services/persistenceService";
import { auditPersistenceService } from "@/services/auditPersistenceService";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { aiFollowupService } from "@/services/aiFollowupService";
import { logger } from "@/lib/logger";
import { ValidationError, getErrorMessage } from "@/lib/errors";
import { OutreachStage } from "@/types";

const DraftRequestSchema = z.object({
  prospectId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = DraftRequestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid request" }, { status: 400 });
    }

    const { prospectId } = parsed.data;

    // 1. Fetch Prospect
    const prospect = await prospectPersistenceService.getProspectById(prospectId);
    if (!prospect) throw new ValidationError("Prospect not found.");

    // 2. Determine Current Stage based on explicit state
    let currentStage: OutreachStage = 1;
    if (prospect.outreachState === 'FOLLOW_UP_1_SENT') currentStage = 2;
    else if (prospect.outreachState === 'FOLLOW_UP_2_SENT') currentStage = 3;
    else if (prospect.outreachState === 'FOLLOW_UP_3_SENT') currentStage = 4; // Close loop
    else if (prospect.outreachState === 'CLOSE_LOOP_SENT' || prospect.outreachState === 'COMPLETED') {
      throw new ValidationError("Outreach sequence is already completed.");
    }

    // 3. Fetch Business & Audit
    const business = await persistenceService.getBusinessById(prospect.businessId);
    if (!business) throw new ValidationError("Business not found.");

    const storedAudit = await auditPersistenceService.getLatestAudit(prospect.businessId);
    const aiReport = storedAudit?.aiReport || null;

    // 4. Fetch Previous Outreach History
    const history = await outreachPersistenceService.getOutreachHistory(prospectId);

    // 5. Generate Draft with Sequence Context
    const draft = await aiFollowupService.generateFollowUpDraft(business, aiReport, history, currentStage);

    return NextResponse.json({ draft });

  } catch (error) {
    logger.error("[API /outreach/followup-draft] Generation failed:", getErrorMessage(error));
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: getErrorMessage(error) }, { status: 400 });
    }
    return NextResponse.json({ error: `Failed to generate follow-up draft: ${getErrorMessage(error)}` }, { status: 500 });
  }
}