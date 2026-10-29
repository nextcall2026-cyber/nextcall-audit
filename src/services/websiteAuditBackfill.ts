import "server-only";

import { Business, EmailData } from "@/types";
import { ParsedNotes } from "@/services/notesParser";
import { isPlausibleEmail, pickBestEmail } from "@/services/contactEmailPicker";
import { persistenceService } from "@/services/persistenceService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * Fills the gaps in a business profile from the website audit the operator
 * pasted into the notes box.
 *
 * The Google Business Profile screenshot often leaves the address — and the
 * screenshot flow never knows the email — so the audit text is the only place
 * that information exists. This runs behind the scenes while the AI report is
 * generated: nothing is shown in the UI, and a value that is already set is
 * never overwritten (the operator's own entry always wins).
 */

export interface BackfillOutcome {
  business: Business;
  /** Human-readable field names that were filled in, for the log only. */
  filled: string[];
}

function missing(value: string | undefined | null): boolean {
  return !value || !value.trim();
}

function mergeEmailEntry(existing: EmailData[], address: string): EmailData[] {
  if (existing.some((email) => email.address.toLowerCase() === address)) {
    return existing;
  }
  return [
    ...existing,
    {
      address,
      type: "BUSINESS",
      sourceUrl: "website audit",
      sourceType: "VISIBLE_TEXT",
      confidence: 85,
    },
  ];
}

/** Pure: computes the backfilled business without touching storage. */
export function backfillBusinessDetails(
  business: Business,
  parsed: ParsedNotes | null
): BackfillOutcome {
  const filled: string[] = [];
  const next: Business = { ...business };

  // --- Postal address ---
  const parsedLocation = parsed?.location ?? null;
  if (parsedLocation) {
    const location = { ...(business.location ?? {}) };
    if (missing(location.address) && parsedLocation.address) {
      location.address = parsedLocation.address;
      filled.push("address");
    }
    if (missing(location.city) && parsedLocation.city) {
      location.city = parsedLocation.city;
      filled.push("city");
    }
    if (missing(location.state) && parsedLocation.state) {
      location.state = parsedLocation.state;
      filled.push("state");
    }
    if (missing(location.zip) && parsedLocation.zip) {
      location.zip = parsedLocation.zip;
      filled.push("zip");
    }
    if (filled.length > 0) next.location = location;
  }

  // --- Phone (notes first, then whatever the crawl found) ---
  if (missing(business.phone)) {
    const phone =
      parsed?.phone ??
      business.enrichment?.phones?.[0]?.normalized ??
      business.enrichment?.phones?.[0]?.number ??
      null;
    if (phone) {
      next.phone = phone;
      filled.push("phone");
    }
  }

  // --- Contact email ---
  const storedEmails = business.enrichment?.emails ?? [];
  const parsedEmails = (parsed?.emails ?? []).map((email) => email.address);
  const storedPreferred = business.enrichment?.preferredEmail ?? null;

  let chosen: string | null = isPlausibleEmail(storedPreferred)
    ? storedPreferred!.trim().toLowerCase()
    : null;

  // A stored preference that the crawl guessed is worth second-guessing when a
  // better (owner-looking) address is available; a user-typed one never is.
  const preferredEntry = storedPreferred
    ? storedEmails.find(
        (email) => email.address.toLowerCase() === storedPreferred.toLowerCase()
      )
    : undefined;
  const preferredIsUserProvided = preferredEntry?.sourceUrl === "user provided";

  if (!chosen || !preferredIsUserProvided) {
    const better = pickBestEmail(
      [chosen, ...storedEmails.map((email) => email.address), ...parsedEmails],
      business.name
    );
    if (better) chosen = better;
  }

  if (chosen) {
    const known = isPlausibleEmail(storedPreferred);
    if (!known || storedPreferred!.toLowerCase() !== chosen) {
      filled.push("email");
    }
    const withParsed = parsedEmails.reduce(mergeEmailEntry, storedEmails);
    next.enrichment = {
      ...(business.enrichment ?? { status: "NOT_STARTED" as const }),
      emails: mergeEmailEntry(withParsed, chosen),
      preferredEmail: chosen,
    };
  }

  return { business: next, filled };
}

/**
 * Stores the backfilled values. Storage problems are logged and swallowed:
 * a profile cleanup must never stop a report from being generated.
 */
export async function applyWebsiteAuditBackfill(
  businessId: string,
  business: Business,
  parsed: ParsedNotes | null
): Promise<Business> {
  const outcome = backfillBusinessDetails(business, parsed);
  if (outcome.filled.length === 0) return business;

  try {
    const coreChanged = outcome.filled.some((field) =>
      ["address", "city", "state", "zip", "phone"].includes(field)
    );
    if (coreChanged) {
      await persistenceService.updateBusinessCore(businessId, {
        location: outcome.business.location,
        phone: outcome.business.phone,
      });
    }
    if (outcome.filled.includes("email") && outcome.business.enrichment) {
      await persistenceService.updateEnrichmentData(
        businessId,
        outcome.business.enrichment
      );
    }
    logger.info(
      `[WebsiteAuditBackfill] Filled ${outcome.filled.join(", ")} for ${businessId} (${business.name}) from the website audit.`
    );
  } catch (error) {
    logger.warn(
      `[WebsiteAuditBackfill] Could not store backfilled details for ${businessId}: ${getErrorMessage(error)}`
    );
  }

  return outcome.business;
}