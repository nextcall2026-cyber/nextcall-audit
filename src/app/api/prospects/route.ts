import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { persistenceService } from "@/services/persistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { opportunityService } from "@/services/opportunityService";
import { pickBestEmailForBusiness } from "@/services/contactEmailPicker";
import { PipelineStatus } from "@/types";
import { logger } from "@/lib/logger";
import { notificationService } from "@/services/notificationService";
import { compareProspectsForPipeline } from "@/lib/pipelineSort";
import {
  getAuditsCollection,
  getBusinessesCollection,
  getOutreachCollection,
  getProspectsCollection,
} from "@/lib/db";
import { getErrorMessage } from "@/lib/errors";

const CreateProspectSchema = z.object({
  businessId: z.string().min(1),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const parsed = CreateProspectSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        {
          error: "Invalid request",
          details: parsed.error.issues,
        },
        { status: 400 }
      );
    }

    const { businessId } = parsed.data;

    const business = await persistenceService.getBusinessById(businessId);

    if (!business) {
      return NextResponse.json({ error: "Business not found" }, { status: 404 });
    }

    // Contact email: an address the operator typed wins; otherwise the same
    // priority rule the report backfill uses — an owner-looking mailbox that
    // carries the business name ("businessname@gmail.com") first, else the
    // first plausible address the audit or website notes mention.
    const contactEmail = pickBestEmailForBusiness(business);

    // Calculate Opportunity Score at add time
    const opportunityScore = opportunityService.calculateScore(business);

    const prospect = await prospectPersistenceService.createProspect(
      businessId,
      contactEmail,
      opportunityScore,
      business
    );

    if (!prospect) {
      throw new Error("Failed to create prospect.");
    }

    // In-app feed: a new prospect is the moment the pipeline list changes.
    await notificationService.notify({
      type: "PROSPECT_ADDED",
      title: `New prospect: ${business.name}`,
      body: contactEmail
        ? `Added to the pipeline · ${contactEmail}`
        : "Added to the pipeline — no contact email detected yet",
      href: `/dashboard/pipeline/${prospect.id}`,
      prospectId: prospect.id,
      businessId,
      dedupeKey: `prospect-added:${prospect.id}`,
    });

    return NextResponse.json({ prospect });
  } catch (error) {
    logger.error("[API /prospects] Creation failed:", getErrorMessage(error));

    return NextResponse.json(
      { error: "Failed to create prospect" },
      { status: 500 }
    );
  }
}

/* ============================================================================
 * GET — the pipeline list.
 *
 * This endpoint used to ask for one business and one audit PER PROSPECT. With
 * ~1000 prospects that is ~2000 database round-trips; at 2-3s each on the free
 * tier it never finished inside the function time limit, the request died, and
 * the pipeline page rendered empty. Everything here is now a bounded number of
 * batched queries, run in parallel waves.
 * ========================================================================== */

/**
 * One page of prospects per request. 100 is deliberate: it is exactly the
 * largest `$in` the Data API accepts, so the name and audit-score lookups each
 * stay a single query instead of fanning out into chunks.
 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

/** Every status the pipeline can hold, so ALL can be summed without a full scan. */
const STATUSES: PipelineStatus[] = [
  "NEW",
  "READY_TO_CONTACT",
  "CONTACTED",
  "FOLLOW_UP",
  "QUALIFIED",
  "CONVERTED",
  "UNQUALIFIED",
  "CLOSED_LOST",
];

/** Counts are re-read at most once a minute; switching tabs costs nothing. */
const COUNT_TTL_MS = 60_000;
let countCache: { counts: Record<string, number>; at: number } | null = null;

/**
 * "Has a timestamp" as a filter the Data API actually evaluates correctly.
 *
 * `{ field: { $ne: null } }` also matches documents where the field is MISSING,
 * and `countDocuments` with `$ne` returns 0 even when rows exist. A timestamp
 * can never be older than the epoch, so a string range is the reliable way to
 * say "this really was opened/clicked".
 */
const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

/**
 * The Data API refuses `$in` with more than 100 values ("operator must have at
 * most 100 values"), so every id list is split before it reaches the database.
 * Silently swallowing that error is what made business names read "Unknown" and
 * every audit score read N/A.
 */
const IN_LIMIT = 100;

function chunk<T>(items: T[], size: number = IN_LIMIT): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

interface ProspectRow {
  id: string;
  businessId: string;
  businessSnapshot?: { name?: string } | null;
  [key: string]: unknown;
}

function utcToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const status = searchParams.get("status") as PipelineStatus | null;
    const view = (searchParams.get("view") ?? status ?? "ALL").toUpperCase();

    const requested = Number(searchParams.get("limit") ?? DEFAULT_LIMIT);
    const limit = Number.isFinite(requested)
      ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(requested)))
      : DEFAULT_LIMIT;

    // The page and the box counts do not depend on each other.
    const [page, counts] = await Promise.all([loadPage(view, limit), loadCounts()]);
    const enriched = await enrich(page);

    return NextResponse.json({
      prospects: enriched,
      counts,
      view,
      limit,
      total: counts[view] ?? counts.ALL ?? 0,
      truncated: (counts[view] ?? 0) > enriched.length,
    });
  } catch (error) {
    logger.error("[API /prospects] Fetch failed:", getErrorMessage(error));

    return NextResponse.json({ error: "Failed to fetch prospects" }, { status: 500 });
  }
}

async function loadPage(view: string, limit: number): Promise<ProspectRow[]> {
  if (view === "OPENED" || view === "CLICKED") {
    return loadTrackedPage(view, limit);
  }

  const collection = await getProspectsCollection();
  const rows = await collection.find(filterForView(view), { limit }).toArray();
  return rows as unknown as ProspectRow[];
}

/**
 * The operator's boxes, not the raw database states.
 *
 * DUE NOW is "what I still owe today": audits that are ready but have never
 * been emailed, plus follow-ups due today or overdue. OPENED and CLICKED come
 * from the outreach records the webhooks and the tracking pixel update.
 */
function filterForView(view: string): Record<string, unknown> {
  if (view === "DUE") {
    return {
      $or: [
        { outreachState: "UNCONTACTED" },
        { nextFollowUpAt: { $lte: utcToday() } },
      ],
    };
  }

  if (view === "AWAITING") return { outreachState: "UNCONTACTED" };
  if (view === "EMAILED") return { outreachState: { $ne: "UNCONTACTED" } };
  if (view === "ALL") return {};

  if (STATUSES.includes(view as PipelineStatus)) {
    return { pipelineStatus: view };
  }

  return {};
}

/**
 * OPENED / CLICKED are read from the outreach records — that is where the
 * provider webhooks and the tracking pixel write the event. The prospects are
 * then loaded by id, so this never scans the whole pipeline.
 */
async function loadTrackedPage(
  view: "OPENED" | "CLICKED",
  limit: number
): Promise<ProspectRow[]> {
  const outreach = await getOutreachCollection();
  const filter =
    view === "OPENED"
      ? { status: "SENT", openedAt: { $gte: EPOCH_ISO } }
      : { status: "SENT", clickedAt: { $gte: EPOCH_ISO } };

  const records = (await outreach
    .find(filter, { limit: 200, projection: { prospectId: true } })
    .toArray()) as unknown as { prospectId?: string }[];

  const ids = [...new Set(records.map((r) => r.prospectId).filter(Boolean))].slice(
    0,
    limit
  ) as string[];

  if (ids.length === 0) return [];

  const collection = await getProspectsCollection();
  const rows = (
    await Promise.all(
      chunk(ids).map((group) =>
        collection.find({ id: { $in: group } }, { limit: group.length }).toArray()
      )
    )
  ).flat();

  return rows as unknown as ProspectRow[];
}

/**
 * Names and audit scores for the rows on screen, in two queries no matter how
 * many rows there are.
 */
async function enrich(rows: ProspectRow[]) {
  if (rows.length === 0) return [];

  const businessIds = [...new Set(rows.map((r) => r.businessId).filter(Boolean))];
  const [names, scores] = await Promise.all([
    loadBusinessNames(businessIds),
    loadAuditScores(businessIds),
  ]);

  return rows
    .map((row) => ({
      ...row,
      businessName:
        names.get(row.businessId) ||
        row.businessSnapshot?.name ||
        "Unknown business",
      auditScore: scores.get(row.businessId) ?? null,
    }))
    .sort(compareProspectsForPipeline as (a: unknown, b: unknown) => number);
}

async function loadBusinessNames(businessIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (businessIds.length === 0) return names;

  try {
    const collection = await getBusinessesCollection();
    const docs = (
      await Promise.all(
        chunk(businessIds).map((group) =>
          collection
            .find(
              { id: { $in: group } },
              { limit: group.length, projection: { id: true, name: true } }
            )
            .toArray()
        )
      )
    ).flat() as unknown as { id?: string; name?: string }[];

    for (const doc of docs) {
      if (doc.id) names.set(doc.id, doc.name ?? "");
    }
  } catch (error) {
    logger.warn(`[API /prospects] Business names unavailable: ${getErrorMessage(error)}`);
  }

  return names;
}

async function loadAuditScores(businessIds: string[]): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const newest = new Map<string, string>();
  if (businessIds.length === 0) return scores;

  try {
    const collection = await getAuditsCollection();
    const docs = (
      await Promise.all(
        chunk(businessIds).map((group) =>
          collection
            .find(
              { businessId: { $in: group } },
              {
                limit: group.length,
                projection: { businessId: true, createdAt: true, "audit.overallScore": true },
              }
            )
            .toArray()
        )
      )
    ).flat() as unknown as {
      businessId?: string;
      createdAt?: string;
      audit?: { overallScore?: number };
    }[];

    for (const doc of docs) {
      const score = doc.audit?.overallScore;
      if (!doc.businessId || typeof score !== "number") continue;

      // Keep the newest audit per business, matching getLatestAudit().
      const createdAt = String(doc.createdAt ?? "");
      const previous = newest.get(doc.businessId);
      if (previous !== undefined && previous >= createdAt) continue;

      newest.set(doc.businessId, createdAt);
      scores.set(doc.businessId, score);
    }
  } catch (error) {
    logger.warn(`[API /prospects] Audit scores unavailable: ${getErrorMessage(error)}`);
  }

  return scores;
}

/**
 * One count per box, all in flight together. Counting the whole collection in a
 * single query is not possible — the Data API refuses past 1000 rows — so ALL is
 * summed from the per-status counts instead.
 */
async function loadCounts(): Promise<Record<string, number>> {
  const cached = countCache;
  if (cached && Date.now() - cached.at < COUNT_TTL_MS) return cached.counts;

  const collection = await getProspectsCollection();

  const [statusCounts, due, awaiting, opened, clicked] = await Promise.all([
    Promise.all(
      STATUSES.map((status) =>
        collection.countDocuments({ pipelineStatus: status }, 1000).catch(() => 0)
      )
    ),
    collection.countDocuments(filterForView("DUE"), 1000).catch(() => 0),
    collection.countDocuments({ outreachState: "UNCONTACTED" }, 1000).catch(() => 0),
    countTracked("OPENED"),
    countTracked("CLICKED"),
  ]);

  const counts: Record<string, number> = {
    DUE: due,
    AWAITING: awaiting,
    OPENED: opened,
    CLICKED: clicked,
  };

  STATUSES.forEach((status, index) => {
    counts[status] = statusCounts[index] ?? 0;
  });

  counts.ALL = STATUSES.reduce((sum, status) => sum + (counts[status] ?? 0), 0);

  // Derived, not queried: countDocuments with $ne is unreliable on this API,
  // and "everyone not awaiting" is exactly what the two totals already say.
  counts.EMAILED = Math.max(0, counts.ALL - counts.AWAITING);

  countCache = { counts, at: Date.now() };
  return counts;
}

async function countTracked(view: "OPENED" | "CLICKED"): Promise<number> {
  try {
    const outreach = await getOutreachCollection();
    const filter =
      view === "OPENED"
        ? { status: "SENT", openedAt: { $gte: EPOCH_ISO } }
        : { status: "SENT", clickedAt: { $gte: EPOCH_ISO } };

    return await outreach.countDocuments(filter, 1000);
  } catch (error) {
    logger.warn(`[API /prospects] ${view} count unavailable: ${getErrorMessage(error)}`);
    return 0;
  }
}