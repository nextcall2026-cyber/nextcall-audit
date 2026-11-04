import z from "zod";

/**
 * Heuristic parser for the OCR text the operator's browser pulled out of a
 * screenshot — zero AI.
 *
 * The Google Business Profile listing has a very stable visual order, so the
 * OCR lines carry everything in the first ~15 lines:
 *   1st listable line      → business name
 *   a dotted rating        → `4.7 (13)` on its own line
 *   a US phone pattern     → (385) 973-2599
 *   a domain-ish token     → jlplumbing.com
 *   a "state + ZIP" line   → Ogden, UT 84404
 *
 * Anything the parser cannot pin down stays null — and the pipeline is free to
 * fall back to the AI vision read (which stays in place exactly for that).
 */

export const OcrGoogleFieldsSchema = z.object({
  name: z.string().min(2).nullish(),
  phone: z.string().min(7).nullish(),
  website: z.string().nullish(),
  address: z.string().nullish(),
  rating: z.number().min(0).max(5).nullish(),
  reviewCount: z.number().int().nonnegative().nullish(),
  category: z.string().nullish(),
  email: z.string().email().nullish(),
});

export type OcrGoogleFields = z.infer<typeof OcrGoogleFieldsSchema>;

export type OcrFacebookFields = Pick<OcrGoogleFields, "name" | "email">;

const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const WEBSITE_RE = /(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9][a-zA-Z0-9-]*\.[a-zA-Z]{2,}(?:\/[^\s,]*)?/;
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(\d{2,4}\)|\d{2,4})[-.\s]?\d{3}[-.\s]?\d{4}/;
/** `4.7 (13)` — survives a leading star or the OCR mangling the dot. */
const RATING_RE = /\b(\d(?:[.,]\d)?)\s*★?\s*\((\d[\d,]*)\)/;

/** State + ZIP marker, e.g. "Ogden, UT 84404" — cheap and very reliable. */
const ADDRESS_RE = /([A-Za-z][A-Za-z .'.-]*,\s*[A-Z]{2}\s+\d{5}(?:-\d{4})?)/;

function toLines(raw: string): string[] {
  return (raw || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/** Google-listing noise: star rows, "Directions", hours, review-line repeats. */
const SKIP_FOR_NAME = /directions|website|closed|open|hours|about|call|save|share|miles|reviews?$|stars?\s*$/i;

function extractName(lines: string[]): string | null {
  for (const line of lines.slice(0, 12)) {
    // Skip: no letters / digit-stuffed lines (phone or rating) / nav noise.
    if (!/[A-Za-z]{3}/.test(line)) continue;
    if (line.replace(/[^0-9]/g, "").length > 3) continue;
    if (RATING_RE.test(line) || WEBSITE_RE.test(line)) continue;
    if (SKIP_FOR_NAME.test(line)) continue;

    // Trailing rating/phone crumbs sometimes stick to the name line.
    const cleaned = line
      .replace(RATING_RE, "")
      .replace(PHONE_RE, "")
      .replace(/^[★☆.:\-•]+\s*/, "")
      .trim();
    if (cleaned.length >= 3 && /[A-Za-z]{3}/.test(cleaned)) return cleaned.slice(0, 90);
  }
  return null;
}

/**
 * Parses the Google Business Profile screenshot's OCR text into the same
 * field-shape the AI vision read produces — so the pipeline is indifferent to
 * which of the two readers produced the values.
 */
export function parseGoogleListingText(raw: string): OcrGoogleFields {
  const lines = toLines(raw);
  const joined = lines.join("\n");

  const ratingMatch = joined.match(RATING_RE);
  const phoneMatch = joined.match(PHONE_RE);

  // The website token must not be the review/aggregator's URL — pick the first
  // domain-looking token that appears AFTER the phone (Google puts the site
  // next to the call button). Fall back to any token when the layout differs.
  const websiteMatches = joined.match(new RegExp(WEBSITE_RE.source, "g")) ?? [];
  const website =
    websiteMatches
      .filter((w) => !/google\.com|goo\.gl|maps\.app|g\.co/i.test(w))
      .find((w) => phoneMatch ? joined.indexOf(w) > joined.indexOf(phoneMatch[0]) : true) ??
    null;

  const addressMatch = joined.match(ADDRESS_RE);

  return {
    name: extractName(lines),
    phone: phoneMatch?.[0] ?? null,
    website,
    address: addressMatch?.[1]?.replace(/\s+/g, " ").trim() ?? null,
    rating: ratingMatch ? Number(ratingMatch[1].replace(",", ".")) : null,
    reviewCount: ratingMatch ? Number(ratingMatch[2].replace(/,/g, "")) : null,
    category: null,
    email: EmailOrNull(joined),
  };
}

function EmailOrNull(text: string): string | null {
  return text.match(EMAIL_RE)?.[0] ?? null;
}

/**
 * The Facebook About screenshot rarely renders the email on every layout, but
 * when it does this catches it — an email in the OCR text is the single most
 * valuable thing the Facebook shot carries (it powers the contact email).
 */
export function parseFacebookListingText(raw: string): OcrFacebookFields {
  const lines = toLines(raw);
  return {
    name: extractName(lines),
    email: EmailOrNull(raw),
  };
}

/**
 * Confidence gate: false positives are worse than falling back to AI. The
 * address / rating / phone stay optional (the audit can live without them),
 * but without a believable NAME there is nothing to save.
 */
export function ocrFieldsUsable(fields: OcrGoogleFields): boolean {
  if (!fields.name) return false;
  const name = fields.name.replace(/[^A-Za-z]/g, "");
  return name.length >= 4;
}
