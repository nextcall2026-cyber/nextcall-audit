import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { Business } from "@/types";
import { persistenceService } from "@/services/persistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { getBusinessesCollection } from "@/lib/db";
import {
  cleanValue,
  extractFromScreenshot,
  ScreenshotError,
} from "@/services/screenshotExtractor";
import { jobQueueService } from "@/services/jobQueueService";
import { warmRouterInBackground } from "@/lib/ai/warmup";
import { logger } from "@/lib/logger";
import { rateLimit } from "@/lib/rateLimiter";
import { getErrorMessage } from "@/lib/errors";

/**
 * Ingest: two screenshots in, one queued audit out.
 *
 * This used to do the whole job — crawl, audit, AI report, pipeline — inside
 * one request, so a 30–60 second run could be cut off by the host and lost.
 * Now it does only what needs the images (read them) and hands the slow work
 * to the audit worker through the job queue. The response comes back in a few
 * seconds and the operator can drop the next business straight away.
 *
 * The screenshots are read and discarded — nothing is stored, so there is no
 * blob storage to pay for and no cleanup job to run.
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
function dedupeKeyFor(name: string, website: string | null): string {
  const domain = website ? domainOf(website) : null;
  return domain ? `d:${domain}` : `n:${normalizeName(name)}`;
}

export async function POST(request: NextRequest) {
  try {
    // Generous: the operator may queue many businesses in a row.
    const rateLimitResponse = rateLimit(request, { intervalMs: 60_000, maxRequests: 20 });
    if (rateLimitResponse) return rateLimitResponse;

    // The router sleeps when idle and takes 60-95s to wake. Nudge it now so the
    // next upload finds it awake; this one may still pay the cold start.
    warmRouterInBackground();

    const formData = await request.formData().catch(() => null);
    const googleFile = formData?.get("google");

    if (!(googleFile instanceof File)) {
      return NextResponse.json(
        { error: "Add a screenshot of the Google Business Profile first." },
        { status: 400 }
      );
    }

    // The Facebook About panel is optional: plenty of businesses have no
    // Facebook page at all. It is only the best place to find an email, not a
    // requirement — without it the audit still runs and the website crawl gets
    // a chance to find the address instead.
    const facebookFile = formData?.get("facebook");
    const facebookProvided = facebookFile instanceof File;

    // Both images are read at the same time, each with a hard cap.
    // Google is required — without a name there is nothing to audit.
    // Facebook is best-effort: if that chain is slow or down we still queue the
    // business, just without the email, instead of failing the whole ingest.
    const [googleSettled, facebookSettled] = await Promise.allSettled([
      // 40s: a warm-but-busy chain needs more than the 25s the optional read
      // gets, and this is the one image the business cannot be built without.
      extractFromScreenshot("google", googleFile, { timeoutMs: 40_000 }),
      facebookProvided
        ? extractFromScreenshot("facebook", facebookFile as File, {
            timeoutMs: 25_000,
          })
        : Promise.resolve(null),
    ]);

    if (googleSettled.status === "rejected") {
      logger.warn(
        `[API /businesses/manual] Google read failed: ${getErrorMessage(googleSettled.reason)}`
      );
    }

    const google = googleSettled.status === "fulfilled" ? googleSettled.value : null;
    const googleFailed = googleSettled.status === "rejected";
    const facebook = facebookSettled.status === "fulfilled" ? facebookSettled.value : null;
    const facebookFailed = facebookSettled.status === "rejected";

    if (facebookFailed) {
      logger.warn(
        `[API /businesses/manual] Facebook read failed, queueing without it: ${getErrorMessage(
          (facebookSettled as PromiseRejectedResult).reason
        )}`
      );
    }

    // Google wins where both have a value (it is the canonical listing);
    // Facebook fills the gaps — above all the email address.
    const name = cleanValue(google?.name) ?? cleanValue(facebook?.name);
    if (!name) {
      // Neither read produced a business name. If one of them already has a
      // precise, actionable message (a timeout, an unreadable image), surface
      // that instead of a generic one.
      const failure =
        googleSettled.status === "rejected"
          ? googleSettled.reason
          : facebookSettled.status === "rejected"
            ? facebookSettled.reason
            : null;

      if (failure instanceof ScreenshotError) throw failure;

      return NextResponse.json(
        {
          error:
            "The business name could not be read from the screenshots. Take the Google screenshot again with the business name clearly visible.",
        },
        { status: 422 }
      );
    }

    const website = normalizeWebsite(cleanValue(google?.website) ?? cleanValue(facebook?.website));
    const phone = cleanValue(google?.phone) ?? cleanValue(facebook?.phone);
    const address = cleanValue(google?.address) ?? cleanValue(facebook?.address);
    const category = cleanValue(google?.category) ?? cleanValue(facebook?.category);
    const email = (cleanValue(facebook?.email) ?? cleanValue(google?.email))?.toLowerCase() ?? null;
    const rating = google?.rating ?? facebook?.rating ?? null;
    const reviewCount = google?.reviewCount ?? facebook?.reviewCount ?? null;

    // 1. Duplicate check — one lookup, no collection scan.
    const dedupeKey = dedupeKeyFor(name, website);
    const existing = await findExistingBusiness(dedupeKey);

    if (existing) {
      const existingProspect = await prospectPersistenceService.getProspectByBusinessId(existing.id);
      logger.info(`[API /businesses/manual] Duplicate blocked: "${name}" (${existing.id}).`);

      return NextResponse.json(
        {
          duplicate: true,
          error: `"${existing.name}" is already in your app, so nothing was queued. Open it from the pipeline if you want to continue with it.`,
          match: {
            businessId: existing.id,
            name: existing.name,
            prospectId: existingProspect?.id ?? null,
          },
        },
        { status: 409 }
      );
    }

    // 2. Save the business with everything the screenshots told us.
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

    // 3. Hand the slow part to the worker.
    const job = await jobQueueService.enqueue({ businessId: id, businessName: name });

    if (!job) {
      return NextResponse.json(
        {
          error:
            "The business was saved, but it could not be added to the queue. Please try adding it again.",
          businessId: id,
        },
        { status: 500 }
      );
    }

    logger.info(`[API /businesses/manual] Queued "${name}" (${id}) as job ${job.id}.`);

    return NextResponse.json({
      queued: true,
      jobId: job.id,
      businessId: id,
      businessName: name,
      emailFound: Boolean(email),
      hasWebsite: Boolean(website),
      // False when no Facebook screenshot was supplied at all — the UI says so
      // instead of implying the page simply had no email.
      facebookUsed: Boolean(facebook),
      ...(googleFailed
        ? {
            warning:
              "The Google listing could not be read in time, so this audit was built from the Facebook page only — the rating and review count will be missing.",
          }
        : facebookFailed
          ? {
              warning:
                "The Facebook screenshot could not be read, so no email was found. The audit will still run.",
            }
          : {}),
    });
  } catch (error) {
    if (error instanceof ScreenshotError) {
      return NextResponse.json({ error: error.userMessage }, { status: error.status });
    }

    logger.error("[API /businesses/manual] Ingest failed:", getErrorMessage(error));
    return NextResponse.json(
      { error: "Something went wrong while reading the screenshots. Please try again." },
      { status: 500 }
    );
  }
}

async function findExistingBusiness(dedupeKey: string): Promise<Business | null> {
  try {
    const collection = await getBusinessesCollection();
    const doc = await collection.findOne({ dedupeKey });
    return (doc as unknown as Business) ?? null;
  } catch (error) {
    // Fail open: a lookup problem must not block the operator from adding work.
    logger.warn(`[API /businesses/manual] Duplicate lookup skipped: ${getErrorMessage(error)}`);
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
