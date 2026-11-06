import { PipelineStatus, Prospect } from "@/types";
import { compareProspectsForPipeline } from "@/lib/pipelineSort";

/**
 * In-memory pipeline list cache, shared between PipelineClient (reads) and
 * ProspectDetailClient (writes via patchCachedProspect).
 *
 * Module scope — it survives client-side route changes, so returning from a
 * prospect detail re-paints the already-loaded list instantly instead of
 * showing a spinner. A full browser refresh clears it, which is the
 * "give me a fresh list" path.
 *
 * When the detail page mutates a prospect (mark-as-viewed, email sent,
 * status change, audit re-run...), patchCachedProspect merges the fresh
 * prospect into every cached list and re-sorts with the canonical pipeline
 * order — so going back shows the CORRECT list immediately, without waiting
 * for the background revalidation.
 */

export interface EnrichedProspect extends Prospect {
  businessName: string;
  auditScore: number | null;
}

/**
 * The boxes the pipeline can show. DUE / AWAITING / EMAILED / OPENED / CLICKED
 * are the operator's questions; the rest are raw pipeline statuses, still
 * accepted so an old link keeps working.
 */
export type PipelineFilter =
  | "DUE"
  | "AWAITING"
  | "EMAILED"
  | "OPENED"
  | "CLICKED"
  | PipelineStatus
  | "ALL";

const cache = new Map<PipelineFilter, EnrichedProspect[]>();
let lastActiveFilter: PipelineFilter = "ALL";

export function getCachedList(filter: PipelineFilter): EnrichedProspect[] | undefined {
  return cache.get(filter);
}

export function hasCachedList(filter: PipelineFilter): boolean {
  return cache.has(filter);
}

export function setCachedList(filter: PipelineFilter, list: EnrichedProspect[]): void {
  cache.set(filter, list);
}

export function getLastActiveFilter(): PipelineFilter {
  return lastActiveFilter;
}

export function setLastActiveFilter(filter: PipelineFilter): void {
  lastActiveFilter = filter;
}

/**
 * Merge a freshly fetched prospect into every cached list and re-sort each
 * one with the canonical pipeline order. The detail page calls this with the
 * prospect it just received from the API.
 */
export function patchCachedProspect(updated: Prospect): void {
  if (!updated?.id) return;

  for (const [filter, list] of cache) {
    if (!list.some((p) => p.id === updated.id)) continue;

    const next = list
      .map((p) =>
        p.id === updated.id
          ? // Keep the list-only enrichment (businessName / auditScore);
            // everything else comes from the fresh prospect.
            { ...p, ...updated, businessName: p.businessName, auditScore: p.auditScore }
          : p
      )
      .sort(compareProspectsForPipeline);

    cache.set(filter, next);
  }
}
