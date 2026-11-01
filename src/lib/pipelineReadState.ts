import { Prospect } from "@/types";

/**
 * What "unread" means in the pipeline.
 *
 * A prospect only needs the operator's attention while nobody has looked at
 * the audit AND no email has gone out. Once an outreach email is sent the
 * audit has already been acted on, so the row is read — whether the AI sent it
 * on its own or the operator pressed the button.
 *
 * This lives in one place because the API's sort order and the list's badges
 * have to agree: if the list shows a row as read but the sorter keeps it at
 * the top as "New", the queue looks broken.
 */

type ReadStateFields = Pick<Prospect, "viewAddedAt" | "lastContactedAt" | "outreachState">;

/** True once any outreach email — initial or follow-up — has gone out. */
export function hasBeenEmailed(prospect: ReadStateFields): boolean {
  if (prospect.lastContactedAt) return true;
  return Boolean(prospect.outreachState) && prospect.outreachState !== "UNCONTACTED";
}

/**
 * A prospect is unread only if it was never opened and never emailed.
 *
 * The `hasBeenEmailed` half also repairs older rows: prospects emailed before
 * the send path started marking them read still have `viewAddedAt: null`, and
 * they should stop shouting "New" without a data migration.
 */
export function isProspectUnread(prospect: ReadStateFields): boolean {
  return !prospect.viewAddedAt && !hasBeenEmailed(prospect);
}
