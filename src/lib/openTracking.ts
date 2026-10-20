import "server-only";
import { getPublicBaseUrl } from "@/lib/env";

/**
 * Builds the open-tracking pixel URL for an outreach record.
 *
 * The base URL comes from getPublicBaseUrl(): NEXT_PUBLIC_APP_URL when set,
 * otherwise Vercel's own production URL, otherwise localhost in development.
 * Without this, production emails pointed their tracking pixel at
 * http://localhost:3000 — which resolves on the RECIPIENT's machine, so the
 * pixel never loaded and open tracking (and the follow-up automation that
 * depends on it) silently never fired.
 */
export function getOpenTrackingUrl(recordId: string): string {
  return `${getPublicBaseUrl()}/api/tracking/open?r=${encodeURIComponent(
    recordId
  )}`;
}
