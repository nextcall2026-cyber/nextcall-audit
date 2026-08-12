import "server-only";
import { env } from "@/lib/env";

/**
 * Builds the open-tracking pixel URL for an outreach record.
 * Falls back to localhost in development when NEXT_PUBLIC_APP_URL
 * is not configured.
 */
export function getOpenTrackingUrl(recordId: string): string {
  const base = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return `${base}/api/tracking/open?r=${encodeURIComponent(recordId)}`;
}
