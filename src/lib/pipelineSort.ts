import { Prospect } from "@/types";
import { isProspectUnread } from "@/lib/pipelineReadState";

/**
 * The canonical pipeline list order — the single source of truth shared by
 * the API (GET /api/prospects) and the client (optimistic cache patches),
 * so a prospect patched on the client lands in the exact position the next
 * server fetch would put it.
 *
 * Order:
 *   1. Prospects that still need attention ("New" — never opened and never
 *      emailed) go to the very top — newest additions first.
 *   2. Everyone else sinks to the bottom, ranked by priorityScore descending
 *      (nulls last), newest first on ties.
 */
export function compareProspectsForPipeline(a: Prospect, b: Prospect): number {
  const aUnread = isProspectUnread(a);
  const bUnread = isProspectUnread(b);
  if (aUnread !== bUnread) return aUnread ? -1 : 1;

  if (aUnread) {
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  }

  const scoreA = a.priorityScore || -1;
  const scoreB = b.priorityScore || -1;
  if (scoreA !== scoreB) return scoreB - scoreA;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}
