import "server-only";
import { z } from "zod";
import { Business, AuditResult, AuditReport } from "@/types";
import { generateLLMResponse } from "@/lib/ai";
import { AI_CHAINS } from "@/lib/ai/chains";
import { logger } from "@/lib/logger";

import { getErrorMessage } from "@/lib/errors";
// Updated Zod schema to match the new expanded report structure
const ReportSchema = z.object({
  executiveSummary: z.string().min(50),
  overallAssessment: z.string().min(50),
  strengths: z.array(z.string()).min(1),
  opportunities: z.array(z.string()).min(1),
  customerExperienceImpact: z.string().min(50),
  nextCallRelevance: z.string().min(50),
  recommendedNextSteps: z.array(z.string()).min(1)
});

export class AIReportService {
  async generateAuditReport(business: Business, audit: AuditResult): Promise<AuditReport> {
    logger.info(`[AIReportService] Generating advanced customer-journey AI report for ${business.name}...`);

    const systemPrompt = `
You are an expert B2B digital presence consultant and conversion-focused business analyst working for NextCall.

NextCall is an AI voice receptionist designed for local service businesses. It can help businesses handle inbound customer calls, answer common questions, capture leads, and assist with appointment scheduling and booking.

Your job is to produce a highly personalized, credible, professional digital presence audit for ONE specific local business using ONLY the verified information provided to you.

The final report should make the business owner feel:
1. "This report is clearly about MY business."
2. "They actually researched my business."
3. "They understand what I'm already doing well."
4. "They identified real opportunities that are relevant to me."
5. "The recommendations are practical and credible."
6. "NextCall may genuinely be useful for my business."

==================================================
WHO IS WHO (CRITICAL)
==================================================
- NextCall is the PRODUCT you are recommending. It is never the business being audited.
- The audited business must ALWAYS be addressed as "your business" (or "you" / "your customers") — NEVER by its name. Even if the business name happens to resemble or equal "NextCall", still say "your business" so a reader can never confuse the product with the business.
- Never write a sentence where "NextCall" could be read as the name of the audited business. If in doubt, use "your business" or "you".

==================================================
NEXTCALL CAPABILITY PROFILE
==================================================
You must ONLY reference the following NextCall capabilities. Select ONLY the 1 or 2 capabilities that most directly address the weakest categories verified in the audit — never more, never generic ones "just in case."

For every capability you mention, connect the chain explicitly:
  observed finding → the friction it may create for customers → the NextCall capability → the practical benefit for your business.
If the audit shows no specific gap (for example, a reachable website and online booking are both detected), do not force a capability; at most present one honest, general benefit and stop.

Core:
- AI voice receptionist
- 24/7 inbound call answering
- Natural voice conversations

Lead Handling:
- Captures caller information
- Captures customer inquiries
- Handles common questions

Appointments:
- Appointment scheduling
- Calendar integration
- Booking assistance

Communication:
- After-hours call handling
- Call routing/escalation (if supported)

Business Benefits:
- Provides an additional customer communication channel
- Helps businesses handle calls when staff are unavailable
- Can assist customers with appointment-related requests

==================================================
CUSTOMER JOURNEY ANALYSIS (CRITICAL)
==================================================
You must interpret the audit through the lens of the customer journey.

Analyze the flow:
Discovery -> Website Visit -> Information Seeking -> Contact Intent -> Appointment Booking -> Call Handling

Do not just report "what exists." Explain HOW the observed digital experience affects the path from discovery to booking.

For example:
Weak: "No booking system detected."
Better: "A prospective customer can discover your business through search, visit your website, and find your phone number. However, we did not detect a publicly accessible online booking option. For customers who prefer to schedule immediately rather than call during business hours, this may create an opportunity to make the next step more convenient."

==================================================
ABSOLUTE FACTUAL ACCURACY RULES
==================================================
You may ONLY use facts explicitly provided in the input.
NEVER invent or assume business information, ratings, review counts, website features, booking systems, social media accounts, emails, phone numbers, business hours, services, customer behavior, revenue, missed calls, lost customers, conversion rates, lead volume, staff size, or business performance.

NEVER claim: "You are losing customers," "You are missing calls," "You are losing money," "Customers cannot reach you," or "Your competitors are outperforming you."

NEVER claim the business's own team is unavailable, busy, or failing to answer calls — unless the input data explicitly states it.

Instead use careful language such as:
- "We did not detect..."
- "Our audit did not find..."
- "No publicly detectable evidence of... was found."
- "This may represent an opportunity to..."
- "If your team receives calls outside business hours, an AI receptionist could potentially help..."

Never turn an absence of evidence into proof of absence. Prefer "not detected" / "unable to verify" over "does not exist".

OWNER-PROVIDED CONTEXT (when present in the input) contains facts the NextCall user verified manually with the business. Treat it as verified ground truth: never contradict it, and never say "we did not detect X" about something the owner context explicitly states — build on it instead.

==================================================
TONE AND VOICE
==================================================
- Professional, warm, respectful, consultative, intelligent, concise, human, specific, and constructive.
- Write like a consultant who actually reviewed the business: direct, concrete, varied sentence lengths, short paragraphs.
- Vary how each paragraph opens — never start two consecutive paragraphs with the same phrase. Avoid repeating the same word ("presence", "opportunity", "may") more than twice within one paragraph.
- Never copy the same sentence into two different fields of the JSON.
- No superlatives, no marketing puffery, no fear-based framing.
- NEVER pushy, aggressive, fear-based, manipulative, condescending, overly enthusiastic, generic, or corporate jargon-heavy.
- Frame weaknesses as "Opportunities for Improvement." The business owner should feel respected.

==================================================
REPORT STRUCTURE & OUTPUT REQUIREMENTS
==================================================
Return ONLY valid JSON matching this exact structure:
{
  "executiveSummary": "2-3 paragraphs. Address the business owner directly as 'your business' (never the business name; never 'NextCall' as the subject of the business). Describe the overall digital presence, highlight strongest aspects, and identify the most important opportunity.",
  "overallAssessment": "1 paragraph summarizing the digital maturity of the business based on the score.",
  "strengths": ["Array of 2-5 concise, factually supported strengths explaining why they matter."],
  "opportunities": ["Array of 2-5 concise opportunities. Explain what was observed and why it may matter to potential customers."],
  "customerExperienceImpact": "1-2 paragraphs analyzing the customer journey based on the audit findings.",
  "nextCallRelevance": "1-2 paragraphs. Explain ONLY the NextCall capabilities that most directly address the verified gaps, each following the chain: observed finding -> the friction it may create for customers -> the NextCall capability -> the practical benefit for your business. Do not mention irrelevant capabilities. Make it feel like a logical conclusion of the findings, never an advertisement.",
  "recommendedNextSteps": ["Array of 2-4 practical, non-pushy next steps the business owner could take."]
}

Do not include Markdown, code fences, additional fields, or commentary outside JSON.
`;

    // Enriched Payload with Actual URLs and Rich Data
    const userPrompt = `
BUSINESS INFORMATION:
- Name: ${business.name}
- Category: ${business.categories?.[0] || "Unknown"}
- Rating: ${business.rating || "Unknown"} / 5 (${business.reviewCount || 0} reviews)
- Phone: ${business.phone || "Not provided"}
- Website URL: ${business.enrichment?.website?.url || business.website || "Not provided"}
- Provider Profile URL: ${business.providerUrl || "Not provided"}
- Location: ${business.location?.city}, ${business.location?.state}

WEBSITE ENRICHMENT DATA:
- Website Reachable: ${business.enrichment?.website?.isReachable ? "Yes" : "No"}
- SSL Certificate: ${business.enrichment?.features?.hasSecureSSL ? "Yes" : "No"}
- Website Title: ${business.enrichment?.website?.title || "Unknown"}
- Website Description: ${business.enrichment?.website?.description || "Unknown"}
- Contact Form Detected: ${business.enrichment?.features?.hasContactForm ? "Yes" : "No"}
- Click-to-Call Detected: ${business.enrichment?.features?.hasClickToCall ? "Yes" : "No"}
- Live Chat Detected: ${business.enrichment?.features?.hasLiveChat ? "Yes" : "No"}

CONTACT METHODS FOUND:
- Public Emails: ${business.enrichment?.emails?.map(e => e.address).join(", ") || "None found"}
- Public Phones: ${business.enrichment?.phones?.map(p => p.normalized || p.number).join(", ") || "None found"}

SOCIAL PROFILES FOUND:
 ${business.enrichment?.socialProfiles?.map(s => `- ${s.platform}: ${s.url}`).join("\n") || "None found"}

BOOKING SYSTEM DETECTED:
 ${business.enrichment?.booking?.detected ? `Yes\n- System: ${business.enrichment.booking.systemName}\n- URL: ${business.enrichment.booking.url || "URL not provided"}` : "No"}

OWNER-PROVIDED CONTEXT (verified manually by the NextCall user — treat as ground truth):
 ${business.notes ? `"""${business.notes}"""` : "- None provided"}

DETERMINISTIC AUDIT RESULT:
- Overall Score: ${audit.overallScore}/100
- Confidence Level: ${audit.confidence}
- Category Scores:
  - Website: ${audit.categoryScores.WEBSITE.score}/100
  - Contactability: ${audit.categoryScores.CONTACTABILITY.score}/100
  - Booking: ${audit.categoryScores.BOOKING.score}/100
  - Reputation: ${audit.categoryScores.REPUTATION.score}/100
  - Social: ${audit.categoryScores.SOCIAL.score}/100

FACTUAL FINDINGS:
 ${audit.findings.map(f => `- ${f.category} - ${f.type}: ${f.title} (Evidence: ${f.evidence})`).join("\n")}

NEXTCALL OPPORTUNITIES MAPPED BY ENGINE:
 ${audit.opportunities.length > 0 ? audit.opportunities.map(o => `- ${o.title}: ${o.evidence}`).join("\n") : "- None mapped by deterministic engine."}
`;

    // One attempt against the single chain. The gateway already falls back
    // across providers, so this only re-runs when every provider failed.
    const attempt = async () => {
      const llm = await generateLLMResponse({
        system: systemPrompt,
        user: userPrompt,
        temperature: 0.5, // Slightly higher to allow for more natural journey analysis, but still grounded
        // The expanded report JSON is long, and reasoning-capable models
        // (e.g. qwen3 on Groq) spend part of the budget on hidden thinking
        // tokens. 1500 used to truncate mid-string -> "json_validate_failed";
        // live testing showed the report needs ~1.2k visible tokens plus
        // reasoning, so give a generous ceiling.
        maxOutputTokens: 8000,
        json: true,
        thinking: "low", // small reasoning budget improves prose quality for this long-form report
        model: AI_CHAINS.main,
        // Hard ceiling for the report call: a slow or hung router model must
        // never eat the worker function's whole execution window (60s). A
        // failed report does not fail the audit — it is retried as its own
        // small REPORT job / regenerated before any email is sent.
        timeoutMs: 45_000,
        singleAttempt: true,
      });

      logger.info(
        `[AIReportService] Report drafted by ${llm.provider} (${llm.model})${llm.fallback ? " [fallback]" : ""}.`
      );

      const parsedJson = JSON.parse(llm.text);
      const validationResult = ReportSchema.safeParse(parsedJson);

      if (!validationResult.success) {
        logger.error("[AIReportService] AI JSON validation failed:", validationResult.error.issues);
        throw new Error("AI response did not match the required expanded schema.");
      }

      return validationResult.data;
    };

    // The router's auto profile serves whichever free model is fastest, and
    // some of them wrap or mangle the JSON. One clean re-roll usually lands
    // on a model that parses — two failures mean the task itself is the
    // problem, and the error propagates to the job's own retry queue.
    let lastReportError: unknown;
    for (let reportAttempt = 1; reportAttempt <= 2; reportAttempt++) {
      try {
        const report = await attempt();
        logger.info(`[AIReportService] Successfully generated advanced report for ${business.name}.`);
        return report;
      } catch (error) {
        lastReportError = error;
        logger.warn(
          `[AIReportService] Report attempt ${reportAttempt}/2 failed: ${getErrorMessage(error)}`
        );
      }
    }
    logger.error(
      `[AIReportService] Failed to generate the AI audit report: ${getErrorMessage(lastReportError)}`
    );
    throw new Error(`Failed to generate AI audit report: ${getErrorMessage(lastReportError)}`);
  }
}

export const aiReportService = new AIReportService();