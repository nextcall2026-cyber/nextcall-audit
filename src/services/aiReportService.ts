import "server-only";
import { z } from "zod";
import { Business, AuditResult, AuditReport } from "@/types";
import { getOpenAIClient } from "@/lib/ai";
import { logger } from "@/lib/logger";

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
    const client = getOpenAIClient();

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
NEXTCALL CAPABILITY PROFILE
==================================================
You must ONLY reference the following NextCall capabilities. Select ONLY the 1 or 2 capabilities that directly address the verified weaknesses in the audit.

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

Instead use careful language such as:
- "We did not detect..."
- "Our audit did not find..."
- "No publicly detectable evidence of... was found."
- "This may represent an opportunity to..."
- "If your team receives calls outside business hours, an AI receptionist could potentially help..."

Never turn an absence of evidence into proof of absence.

==================================================
TONE AND VOICE
==================================================
- Professional, warm, respectful, consultative, intelligent, concise, human, specific, and constructive.
- NEVER pushy, aggressive, fear-based, manipulative, condescending, overly enthusiastic, generic, or corporate jargon-heavy.
- Frame weaknesses as "Opportunities for Improvement." The business owner should feel respected.

==================================================
REPORT STRUCTURE & OUTPUT REQUIREMENTS
==================================================
Return ONLY valid JSON matching this exact structure:
{
  "executiveSummary": "2-3 paragraphs. Mention the business naturally. Describe the overall digital presence, highlight strongest aspects, and identify the most important opportunity.",
  "overallAssessment": "1 paragraph summarizing the digital maturity of the business based on the score.",
  "strengths": ["Array of 2-5 concise, factually supported strengths explaining why they matter."],
  "opportunities": ["Array of 2-5 concise opportunities. Explain what was observed and why it may matter to potential customers."],
  "customerExperienceImpact": "1-2 paragraphs analyzing the customer journey based on the audit findings.",
  "nextCallRelevance": "1-2 paragraphs. Explain ONLY the NextCall capabilities that directly address the identified opportunities. Do not mention irrelevant capabilities. Make it feel like a logical conclusion, not an advertisement.",
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
- Public Phones: ${business.enrichment?.phones?.join(", ") || "None found"}

SOCIAL PROFILES FOUND:
 ${business.enrichment?.socialProfiles?.map(s => `- ${s.platform}: ${s.url}`).join("\n") || "None found"}

BOOKING SYSTEM DETECTED:
 ${business.enrichment?.booking?.detected ? `Yes\n- System: ${business.enrichment.booking.systemName}\n- URL: ${business.enrichment.booking.url || "URL not provided"}` : "No"}

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

    try {
      const response = await client.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.5, // Slightly higher to allow for more natural journey analysis, but still grounded
        max_tokens: 1500, // Increased to accommodate the expanded report structure
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error("AI returned empty response.");
      }

      const parsedJson = JSON.parse(content);
      const validationResult = ReportSchema.safeParse(parsedJson);

      if (!validationResult.success) {
        logger.error("[AIReportService] AI JSON validation failed:", validationResult.error.issues);
        throw new Error("AI response did not match the required expanded schema.");
      }

      logger.info(`[AIReportService] Successfully generated advanced report for ${business.name}.`);
      return validationResult.data;

    } catch (error: any) {
      logger.error(`[AIReportService] Failed to generate report: ${error.message}`);
      throw new Error("Failed to generate AI audit report.");
    }
  }
}

export const aiReportService = new AIReportService();