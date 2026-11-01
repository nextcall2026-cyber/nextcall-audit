import "server-only";

import { z } from "zod";
import { generateLLMResponse } from "@/lib/ai";
import { AI_CHAINS } from "@/lib/ai/chains";
import { logger } from "@/lib/logger";

/**
 * Reads business details out of the two screenshots the operator supplies:
 *
 *   - "google"   — the Google Business Profile listing (name, phone, website,
 *                  address, rating, review count, category)
 *   - "facebook" — the Facebook Page "About / Intro" panel. This one matters
 *                  most for the email address: ~95% of pages show one there,
 *                  while only ~20% of small-business websites do.
 *
 * The image is never stored — it is read here and dropped, which is why the
 * app needs no blob storage and no cleanup job.
 */

export type ScreenshotKind = "google" | "facebook";

const ExtractedSchema = z.object({
  name: z.string().nullish(),
  phone: z.string().nullish(),
  website: z.string().nullish(),
  address: z.string().nullish(),
  rating: z.number().min(0).max(5).nullish(),
  reviewCount: z.number().int().min(0).nullish(),
  category: z.string().nullish(),
  email: z.string().nullish(),
  services: z.array(z.string()).nullish(),
  hours: z.string().nullish(),
});

export type ExtractedScreenshotFields = z.infer<typeof ExtractedSchema>;

const GOOGLE_PROMPT = `You extract business details from a screenshot of a Google Maps (or similar map directory) business listing.

Rules:
- Extract ONLY text and values that are clearly visible in the screenshot. Never guess or infer.
- "name" is the business name shown in the listing.
- "phone" is the phone number exactly as shown (digits, spaces and dashes allowed).
- "website" is the website URL shown in the listing. Return it with scheme if present, otherwise as-is (e.g. jlplumbing.com).
- "address" is the full street address shown.
- "rating" is the star rating as a number between 0 and 5 (e.g. 4.7).
- "reviewCount" is the number of reviews shown (e.g. 123 from "4.7 (123)").
- "category" is the business type/category if shown (e.g. Plumber, Restaurant, Salon).
- "email" is an email address if one is visible anywhere in the screenshot.
- If a field is not visible, return null for it. Do NOT invent values.
- Return ONLY a JSON object with keys: name, phone, website, address, rating, reviewCount, category, email, services, hours.`;

const FACEBOOK_PROMPT = `You extract business details from a screenshot of a Facebook Page's "About", "Intro" or "Details" section.

Rules:
- Extract ONLY text and values that are clearly visible. Never guess or infer.
- "email" is THE MOST IMPORTANT field. Look for an address in the contact details, the intro text, or anywhere else on the page. Return it exactly as printed.
- "name" is the page/business name shown at the top.
- "phone" is a phone number if the page lists one.
- "website" is a website link if the page lists one.
- "address" is a street address or "Located in ..." text if shown.
- "category" is the page category (e.g. "Landscaper", "Plumber", "Home service").
- "services" is a list of services the page mentions, as short phrases (e.g. ["Landscape design", "Hardscaping"]).
- "hours" is the opening hours as one line if shown.
- "rating" and "reviewCount" are the star rating and number of reviews if shown (e.g. 4.9 and 12).
- If a field is not visible, return null for it. Do NOT invent values.
- Return ONLY a JSON object with keys: name, phone, website, address, rating, reviewCount, category, email, services, hours.`;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export class ScreenshotError extends Error {
  readonly userMessage: string;
  readonly status: number;

  constructor(userMessage: string, status = 422) {
    super(userMessage);
    this.name = "ScreenshotError";
    this.userMessage = userMessage;
    this.status = status;
  }
}

export async function extractFromScreenshot(
  kind: ScreenshotKind,
  file: File,
  options: { timeoutMs?: number; attempts?: number } = {}
): Promise<ExtractedScreenshotFields> {
  if (!file.type.startsWith("image/")) {
    throw new ScreenshotError("One of the uploaded files is not an image. Use PNG, JPG or WEBP.", 400);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ScreenshotError("That screenshot is larger than 8 MB. Please use a smaller image.", 400);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const label = kind === "google" ? "Google Business Profile" : "Facebook About";
  const attempts = Math.max(1, options.attempts ?? 2);

  let parsed: ExtractedScreenshotFields | null = null;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= attempts && !parsed; attempt++) {
    try {
      const llm = await generateLLMResponse({
        system: kind === "google" ? GOOGLE_PROMPT : FACEBOOK_PROMPT,
        user: `Extract the business details from this ${label} screenshot. If a field is not visible, return null for it.`,
        images: [{ mimeType: file.type, data: bytes.toString("base64") }],
        temperature: 0,
        maxOutputTokens: 1200,
        json: true,
        thinking: "off",
        // Each screenshot type has its own chain, so a slow Google read never
        // holds up the Facebook one and neither competes for the same quota.
        model: kind === "google" ? AI_CHAINS.visionListing : AI_CHAINS.visionSocial,
        timeoutMs: options.timeoutMs,
        // The upload has a hard time budget: the gateway's extra 2s-delayed
        // retry would turn one 25s timeout into 52s and blow the request.
        singleAttempt: true,
      });

      if (!llm.text) break;

      try {
        const result = ExtractedSchema.safeParse(JSON.parse(llm.text));
        if (result.success) parsed = result.data;
      } catch {
        logger.warn(`[ScreenshotExtractor] ${label}: unreadable JSON on attempt ${attempt}.`);
      }
    } catch (error) {
      lastError = error;
      logger.warn(
        `[ScreenshotExtractor] ${label}: attempt ${attempt} failed — ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  if (!parsed) {
    throw new ScreenshotError(describeFailure(label, lastError));
  }

  return parsed;
}

/**
 * Turns the raw failure into something the operator can act on.
 *
 * "Take a clearer screenshot" is the wrong advice when the image was fine and
 * the image reader was simply still starting up — that is what a cold router
 * looks like, and pressing the button again a few seconds later works.
 */
function describeFailure(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const slow = /no response|timed out|timeout|aborted|within \d+ms|fetch failed|ECONNRESET/i.test(
    message
  );

  if (slow) {
    return `The image reader did not respond in time, so the ${label} screenshot was not read. This is usually a temporary slowdown — wait a few seconds and press "Add to queue" again. The screenshot itself is fine.`;
  }

  return `The ${label} screenshot could not be read. Take a clearer screenshot (make sure the business name and contact details are visible) and try again.`;
}

/** Trims a value and turns blanks into null. */
export function cleanValue(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
