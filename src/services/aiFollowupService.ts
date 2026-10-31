import "server-only";

import {
  Business,
  StoredAudit,
  OutreachRecord,
  FollowUpDraft,
  OutreachStage,
  CTAType,
} from "@/types";
import { generateLLMResponse } from "@/lib/ai";
import { AI_CHAINS } from "@/lib/ai/chains";
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

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export class AIFollowupService {
  async generateFollowUpDraft(
    business: Business,
    storedAudit: StoredAudit | null,
    previousOutreach: OutreachRecord[],
    currentStage: OutreachStage
  ): Promise<FollowUpDraft> {
    logger.info(
      `[AIFollowupService] Generating follow-up Stage ${currentStage} for ${business.name}...`
    );

    // ------------------------------------------------------------------
    // 1. Sequence strategy: what this stage is for, its CTA options, and
    //    how long the draft may be (later stages get progressively shorter).
    // ------------------------------------------------------------------
    let sequenceAngle = "";
    let callToActionOptions = "";
    let stageWordLimit = 110;

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
      stageWordLimit = 70;
    } else {
      sequenceAngle =
        "Breakup Email (Stage 4): Polite close-the-loop. Assume they are busy and might have missed the previous emails. Leave the door open for the future.";
      callToActionOptions =
        "State that you'll close the loop for now but will be available if they decide to explore this in the future. (Use ctaType: CLOSE_LOOP)";
      stageWordLimit = 60;
    }

    // ------------------------------------------------------------------
    // 2. Anti-repetition: every previously used angle, subject, and opening
    //    phrase becomes forbidden text for this draft.
    //    Substring matching, so "Audit finding: Appointment Scheduling"
    //    from the initial email also blocks the plain
    //    "Appointment Scheduling" — the old exact-match check missed that.
    // ------------------------------------------------------------------
    const sent = previousOutreach.filter((o) => o.status === "SENT");
    const usedText = [
      ...sent.filter((o) => o.angle).map((o) => o.angle!.toLowerCase()),
      ...sent.map((o) => o.subject.toLowerCase()),
    ].join(" | ");

    const allOpportunities = storedAudit?.aiReport?.opportunities || [];
    const availableOpportunities = allOpportunities.filter(
      (opp) => !usedText.includes(opp.toLowerCase())
    );

    const opportunityContext =
      availableOpportunities.length > 0
        ? availableOpportunities.map((o) => `- ${o}`).join("\n")
        : "- None left — every specific opportunity was already used in previous emails. Choose angle 'General Benefit' and tie it to this business's category and situation.";

    // ------------------------------------------------------------------
    // 3. Personalization dossier: everything the app already knows about
    //    this business, so the draft can open with a detail that is only
    //    true for THEM. All fields are optional-safe ("Unknown" when absent).
    // ------------------------------------------------------------------
    const audit = storedAudit?.audit ?? null;

    const location =
      [business.location?.city, business.location?.state]
        .filter(Boolean)
        .join(", ") || "Unknown";
    const categories =
      business.categories?.filter(Boolean).join(", ") || "Unknown";
    const rating =
      business.rating != null
        ? `${business.rating}/5${
            business.reviewCount ? ` across ${business.reviewCount} reviews` : ""
          }`
        : "Unknown";
    const websiteUrl =
      business.enrichment?.website?.url || business.website || null;
    const websiteLine = websiteUrl
      ? `${websiteUrl}${
          business.enrichment?.website?.isReachable === false
            ? " (could not be reached at audit time)"
            : ""
        }`
      : "None found";

    const booking = business.enrichment?.booking;
    const bookingLine = !booking
      ? "Not verified"
      : booking.detected
      ? `Detected${booking.systemName ? ` (${booking.systemName})` : ""}`
      : "No publicly detectable online booking";

    const socials =
      business.enrichment?.socialProfiles?.map((s) => s.platform).join(", ") ||
      "None found";

    const features = business.enrichment?.features;
    const featureBits: string[] = [];
    if (features?.hasContactForm === true) featureBits.push("contact form");
    if (features?.hasClickToCall === true) featureBits.push("click-to-call");
    if (features?.hasLiveChat === true) featureBits.push("live chat");
    const featuresLine =
      featureBits.length > 0
        ? featureBits.join(", ")
        : "none of the standard website features were clearly detected";

    const notesLine = business.notes?.trim()
      ? `"${business.notes.trim().slice(0, 600)}"`
      : "None";

    const overallScore = audit
      ? `${audit.overallScore}/100 (confidence: ${audit.confidence})`
      : "No audit available";

    const weakestCategories = audit
      ? Object.entries(audit.categoryScores)
          .sort((a, b) => a[1].score - b[1].score)
          .slice(0, 2)
          .map(([name, s]) => `${name} (${s.score}/100)`)
          .join(", ")
      : "Unknown";

    const findingLines =
      (audit?.findings ?? [])
        .filter((f) => f.type !== "STRENGTH")
        .slice(0, 4)
        .map((f) => `- [${f.category}] ${f.title} — ${f.evidence}`)
        .join("\n") || "- None recorded";

    const strengthLines =
      (audit?.findings ?? [])
        .filter((f) => f.type === "STRENGTH")
        .slice(0, 3)
        .map((f) => `- [${f.category}] ${f.title} — ${f.evidence}`)
        .join("\n") || "- None recorded";

    const historyBlock =
      sent.length > 0
        ? sent
            .map((email, i) => {
              const opening = email.body
                ? `\n  Opening: "${stripHtml(email.body).slice(0, 160)}"`
                : "";
              return `- Email ${i + 1} (${
                email.type === "INITIAL"
                  ? "initial audit email"
                  : `follow-up stage ${email.sequenceStage}`
              })\n  Subject: "${email.subject}"\n  Angle used: ${
                email.angle || "None"
              }${opening}`;
            })
            .join("\n")
        : "- None";

    // ------------------------------------------------------------------
    // 4. Prompts
    // ------------------------------------------------------------------
    const systemPrompt = `
You write follow-up emails for NextCall, an AI voice receptionist for local service businesses. You write as one human consultant speaking in the first person ("I") — never as a marketing department.

THE ONE GOAL
The email must feel like it was written by someone who actually looked at THIS business before hitting send. A follow-up that could have been sent to anyone gets deleted; one that could only have been written for them gets replies.

HOW TO PERSONALIZE (in priority order)
1. Open with ONE concrete detail from the business context or audit data: their rating or review count, their booking setup, their category or city, or a specific audit finding. Never open with the follow-up itself — "I'm following up" is an instant delete.
2. Build forward from the audit they already received. Do NOT re-explain the audit, re-list its findings, or repeat the initial email's structure.
3. When you reference a gap, use evidence-aware wording: "I noticed", "I didn't see", "no publicly detectable", "the audit flagged". Never "you don't have", and never claims about lost customers, missed calls, or lost money — the audit never proved those.

HARD RULES
1. Use ONLY facts present in the provided context. Never invent ratings, tools, services, hours, or outcomes.
2. Length: at most ${stageWordLimit} words in the body (excluding the sign-off), two short paragraphs maximum.
3. Never reuse any subject, angle, or opening phrase that appears under PREVIOUS OUTREACH. Vary sentence rhythm and paragraph shape.
4. Banned phrases: "I hope this email finds you well", "just checking in", "following up", "circling back", "touching base", "as a valued", "quick question" in subjects, urgency or scarcity of any kind, emoji, exclamation marks.
5. Subject: 3-7 words, natural and specific to the angle you chose. It should sound like a person, not a campaign.
6. Tone: professional, warm, human, confident. Short sentences are fine.
7. Pick exactly ONE angle from AVAILABLE OPPORTUNITIES that was not used before. If none remain, use angle "General Benefit".
8. The "ctaType" must be one of the exact enum values listed in the stage's Call to Action options.
9. End the body with a simple sign-off on separate lines:
Best regards,
The NextCall Team
10. Body is plain text with \\n\\n line breaks (no HTML, no Markdown).

Return ONLY valid JSON matching exactly:
{
  "subject": "string",
  "body": "string",
  "ctaType": "string",
  "angle": "string"
}
The "angle" must be the exact title of the opportunity you chose, or "General Benefit".
`;

    const userPrompt = `
BUSINESS CONTEXT (verified data about THIS business):
- Name: ${business.name}
- Category: ${categories}
- Location: ${location}
- Rating: ${rating}
- Website: ${websiteLine}
- Online booking: ${bookingLine}
- Website features: ${featuresLine}
- Social profiles: ${socials}
- Owner-provided notes (verified by the NextCall user — treat as ground truth): ${notesLine}

AUDIT CONTEXT (the audit this business already received):
- Overall score: ${overallScore}
- Weakest categories: ${weakestCategories}
- Key findings:
${findingLines}
- Verified strengths:
${strengthLines}

AVAILABLE OPPORTUNITIES (choose ONE angle from this list):
 ${opportunityContext}

PREVIOUS OUTREACH (never repeat any subject, angle, or opening phrase from these):
 ${historyBlock}

SEQUENCE STRATEGY:
- Current stage: ${sequenceAngle}
- Call to Action: You must select one of these types for the "ctaType" field: ${callToActionOptions}

Write the Stage ${currentStage} follow-up email draft now.
`;

    try {
      const llm = await generateLLMResponse({
        system: systemPrompt,
        user: userPrompt,
        temperature: 0.65,
        // Reasoning-capable models (e.g. qwen3 on Groq) spend part of this
        // budget on hidden thinking tokens before writing the JSON.
        maxOutputTokens: 1500,
        json: true,
        thinking: "off",
        model: AI_CHAINS.followup,
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
