import "server-only";

import {
  Business,
  AuditReport,
  OutreachRecord,
  FollowUpDraft,
  OutreachStage,
  CTAType,
} from "@/types";
import { generateLLMResponse } from "@/lib/ai";
import { logger } from "@/lib/logger";

import { z } from "zod";

import { getErrorMessage } from "@/lib/errors";
const FollowUpSchema = z.object({
  subject: z.string().min(5, "Subject must be natural and descriptive"),
  body: z.string().min(50, "Body must be detailed"),
  ctaType: z.enum([
    "ASK_INTEREST",
    "ASK_PERMISSION",
    "OFFER_AUDIT",
    "OFFER_DEMO",
    "ASK_QUICK_QUESTION",
    "OPEN_ENDED_REPLY",
    "CLOSE_LOOP",
  ]),
  angle: z.string().min(5, "Angle must be descriptive"),
});

export class AIFollowupService {
  async generateFollowUpDraft(
    business: Business,
    auditReport: AuditReport | null,
    previousOutreach: OutreachRecord[],
    currentStage: OutreachStage
  ): Promise<FollowUpDraft> {
    logger.info(
      `[AIFollowupService] Generating follow-up Stage ${currentStage} for ${business.name}...`
    );

    // 1. Determine Sequence Strategy & Angle based on explicit stage
    let sequenceAngle = "";
    let callToActionOptions = "";

    if (currentStage === 1) {
      sequenceAngle =
        "Follow-up #1: Gentle reminder. Reference the previous email briefly and highlight ONE specific value point or opportunity.";
      callToActionOptions =
        "Ask if they would like you to send over the full audit report, or if they have 5 minutes to chat next week. (Use ctaType: ASK_INTEREST or OFFER_AUDIT)";
    } else if (currentStage === 2) {
      sequenceAngle =
        "Follow-up #2: Different angle. Focus on a practical benefit of NextCall (e.g., 24/7 lead capture, appointment scheduling) without repeating the first email.";
      callToActionOptions =
        "Ask if they would be open to seeing how an AI receptionist could work for their specific business, or if a quick demo would be useful. (Use ctaType: ASK_PERMISSION or OFFER_DEMO)";
    } else if (currentStage === 3) {
      sequenceAngle =
        "Follow-up #3: Short, low-pressure final check-in. Keep it very brief.";
      callToActionOptions =
        "Ask a simple, low-friction question like 'Is this something you're exploring this quarter?'. (Use ctaType: ASK_QUICK_QUESTION or OPEN_ENDED_REPLY)";
    } else {
      sequenceAngle =
        "Breakup Email (Stage 4): Polite close-the-loop. Assume they are busy and might have missed the previous emails. Leave the door open for the future.";
      callToActionOptions =
        "State that you'll close the loop for now but will be available if they decide to explore this in the future. (Use ctaType: CLOSE_LOOP)";
    }

    // 2. Extract Used & Available Opportunities
    const usedAngles = previousOutreach
      .filter((o) => o.status === "SENT" && o.angle)
      .map((o) => o.angle!.toLowerCase());

    const allOpportunities = auditReport?.opportunities || [];
    const availableOpportunities = allOpportunities.filter(
      (opp) => !usedAngles.includes(opp.toLowerCase())
    );

    const opportunityContext =
      availableOpportunities.length > 0
        ? availableOpportunities.map((o) => `- ${o}`).join("\n")
        : "No new specific opportunities left. Focus on general NextCall benefits (24/7 lead capture, appointment scheduling). Use angle: 'General Benefit'.";

    // 3. Construct Prompts
    const systemPrompt = `
You are an expert B2B sales assistant writing a follow-up email for the NextCall AI voice receptionist.

Your goal is to write a brief, polite, and highly personalized follow-up based on the specific sequence stage.

CRITICAL RULES:
1. Do NOT repeat the initial audit. Keep it brief (2-3 short paragraphs).
2. Do NOT invent facts, ratings, or features. Use only the provided context.
3. Do NOT use manipulative urgency or claim they are "missing calls" or "losing money."
4. Do NOT use generic subject lines like "Following Up", "Just Checking In", or "Quick Question". Make the subject natural and relevant to the business or the specific value point.
5. You MUST select ONE angle/opportunity from the "Available Opportunities" list provided. Do not use an angle that was already used in previous emails.
6. Avoid repeating the exact same phrasing from previous emails. Vary your approach.
7. Maintain a professional, warm, and non-pushy tone.
8. Use the provided Context to ground your statements.
9. Return ONLY valid JSON matching this structure:

{
  "subject": "string",
  "body": "string",
  "ctaType": "string",
  "angle": "string"
}

The body should be plain text with line breaks (\\n\\n), not HTML.
The "angle" must be the exact title of the opportunity you chose, or "General Benefit" if none are available.
The "ctaType" must be one of the exact enum values provided in the Call to Action options.
`;

    const userPrompt = `
BUSINESS CONTEXT (Use this for personalization):
- Name: ${business.name}
- Category: ${business.categories?.[0] || "Unknown"}

AVAILABLE OPPORTUNITIES (Choose ONE for your angle):
 ${opportunityContext}

SEQUENCE STRATEGY:
- Current Stage: ${sequenceAngle}
- Call to Action: You must select one of these types for the "ctaType" field: ${callToActionOptions}

PREVIOUS OUTREACH CONTEXT (To avoid repetition):
 ${previousOutreach
  .filter((o) => o.status === "SENT")
  .map(
    (email, i) =>
      `- Email ${i + 1} Subject: ${email.subject}\n- Angle Used: ${
        email.angle || "None"
      }`
  )
  .join("\n\n")}

Please write the follow-up email draft for Stage ${currentStage}.
`;

    try {
      const llm = await generateLLMResponse({
        system: systemPrompt,
        user: userPrompt,
        temperature: 0.7,
        maxOutputTokens: 500,
        json: true,
        thinking: "off",
      });
      logger.info(
        `[AIFollowupService] Draft generated by ${llm.provider} (${llm.model})${llm.fallback ? " [fallback]" : ""}.`
      );

      const content = llm.text;

      const parsedJson = JSON.parse(content);

      const validationResult = FollowUpSchema.safeParse(parsedJson);

      if (!validationResult.success) {
        logger.error(
          "[AIFollowupService] AI JSON validation failed:",
          validationResult.error.issues
        );

        throw new Error(
          "AI response did not match the required schema."
        );
      }

      // Body stays plain text: every sender passes it through
      // renderEmailHtml, which does the single canonical newline -> <br>
      // conversion (HTML-ifying here would get escaped a second time).
      logger.info(
        `[AIFollowupService] Successfully generated Stage ${currentStage} draft. Angle: ${validationResult.data.angle}`
      );

      return {
        subject: validationResult.data.subject,
        body: validationResult.data.body,
        stage: currentStage,
        ctaType: validationResult.data.ctaType as CTAType,
        angle: validationResult.data.angle,
      };
    } catch (error) {
      logger.error(
        `[AIFollowupService] Failed to generate draft: ${getErrorMessage(error)}`
      );

      throw new Error(
        "Failed to generate AI follow-up draft."
      );
    }
  }
}

export const aiFollowupService = new AIFollowupService();