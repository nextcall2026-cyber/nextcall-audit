import "server-only";

import { randomUUID } from "crypto";
import { Business } from "@/types";
import { persistenceService } from "@/services/persistenceService";
import { getBusinessesCollection } from "@/lib/db";
import { cleanValue, ExtractedScreenshotFields } from "@/services/screenshotExtractor";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * Turns the AI's screenshot reads into a saved business.
 *
 * Used by the audit worker after it has read the stored uploads. The old
 * ingest route owned this logic inline; it moved here so queue time does zero
 * AI work and the read+save+pipeline all happen inside one resumable job.
 */

function normalizeWebsite(input: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function domainOf(url: string): string | null {
  try {
    const withScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url) ? url : `https://${url}`;
    return new URL(withScheme).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * A single cheap key so the duplicate check is one lookup instead of a full
 * collection scan: the website domain when there is one, otherwise the
 * squashed business name. A duplicate that slips past this (same business,
 * different domain) is still caught later by the one-business-one-email guard
 * at send time.
 */
export function dedupeKeyFor(name: string, website: string | null): string {
  const domain = website ? domainOf(website) : null;
  return domain ? `d:${domain}` : `n:${normalizeName(name)}`;
}

export async function findExistingBusiness(dedupeKey: string): Promise<Business | null> {
  try {
    const collection = await getBusinessesCollection();
    const doc = await collection.findOne({ dedupeKey });
    return (doc as unknown as Business) ?? null;
  } catch (error) {
    // Fail open: a lookup problem must not block work from proceeding.
    logger.warn(`[BusinessIngest] Duplicate lookup skipped: ${getErrorMessage(error)}`);
    return null;
  }
}

/** The Facebook extras feed the audit — services and hours are real signals. */
function buildNotes(facebook: {
  services?: string[] | null;
  hours?: string | null;
}): string | undefined {
  const lines: string[] = [];

  const services = (facebook.services ?? []).map((s) => s.trim()).filter(Boolean);
  if (services.length > 0) lines.push(`Services (from Facebook): ${services.join(", ")}`);
  if (facebook.hours) lines.push(`Hours (from Facebook): ${facebook.hours}`);

  return lines.length > 0 ? lines.join("\n") : undefined;
}

export interface SavedBusinessResult {
  business: Business;
  /** Non-null when the screenshots matched a business already in the app. */
  duplicateOf: Business | null;
}

/**
 * Merges the two reads (Google wins where both have a value — it is the
 * canonical listing; Facebook fills the gaps, above all the email address)
 * and saves the business. Returns the existing row untouched on a duplicate.
 */
export async function saveBusinessFromScreenshots(
  google: ExtractedScreenshotFields | null,
  facebook: ExtractedScreenshotFields | null
): Promise<SavedBusinessResult> {
  const name = cleanValue(google?.name) ?? cleanValue(facebook?.name);
  if (!name) {
    throw new Error("The business name could not be read from the screenshots.");
  }

  const website = normalizeWebsite(cleanValue(google?.website) ?? cleanValue(facebook?.website));
  const phone = cleanValue(google?.phone) ?? cleanValue(facebook?.phone);
  const address = cleanValue(google?.address) ?? cleanValue(facebook?.address);
  const category = cleanValue(google?.category) ?? cleanValue(facebook?.category);
  const email = (cleanValue(facebook?.email) ?? cleanValue(google?.email))?.toLowerCase() ?? null;
  const rating = google?.rating ?? facebook?.rating ?? null;
  const reviewCount = google?.reviewCount ?? facebook?.reviewCount ?? null;

  const dedupeKey = dedupeKeyFor(name, website);
  const existing = await findExistingBusiness(dedupeKey);

  if (existing) {
    return { business: existing, duplicateOf: existing };
  }

  const id = randomUUID();

  const business: Business = {
    id,
    name,
    phone: phone ?? undefined,
    website: website ?? undefined,
    location: address ? { address } : undefined,
    rating: rating ?? undefined,
    reviewCount: reviewCount ?? undefined,
    categories: category ? [category] : [],
    providerIds: { manual: id },
    status: "active",
    sources: ["MANUAL"],
    notes: buildNotes(facebook ?? {}),
    dedupeKey,
    enrichment: email
      ? {
          status: "NOT_STARTED",
          emails: [
            {
              address: email,
              type: "BUSINESS" as const,
              sourceUrl: "facebook about screenshot",
              sourceType: "VISIBLE_TEXT" as const,
              confidence: 100,
            },
          ],
          preferredEmail: email,
        }
      : undefined,
  };

  await persistenceService.upsertBusiness(business);
  logger.info(`[BusinessIngest] Saved "${name}" (${id}) from screenshots.`);

  return { business, duplicateOf: null };
}
