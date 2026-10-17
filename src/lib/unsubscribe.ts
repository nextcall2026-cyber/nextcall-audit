import "server-only";
import crypto from "crypto";
import { env } from "@/lib/env";

/**
 * Signed unsubscribe links for email footers.
 *
 * The link identifies the outreach record that carried the email and is
 * signed with an HMAC, so recipients can only unsubscribe via the exact
 * link they received — tokens for arbitrary prospect ids cannot be forged
 * without the server secret.
 */
function getSigningSecret(): string {
  // RESEND_WEBHOOK_SECRET is optional in env, but APP_PASSWORD is required,
  // so a signing secret always exists.
  return env.RESEND_WEBHOOK_SECRET ?? env.APP_PASSWORD;
}

export function getUnsubscribeToken(outreachRecordId: string): string {
  return crypto
    .createHmac("sha256", getSigningSecret())
    .update(`unsubscribe:${outreachRecordId}`)
    .digest("hex")
    .slice(0, 32);
}

export function getUnsubscribeUrl(outreachRecordId: string): string {
  const base = env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  // Lives under /api/tracking because that prefix is already allowlisted in
  // middleware.ts for unauthenticated email-recipient endpoints.
  const url = new URL("/api/tracking/unsubscribe", base);
  url.searchParams.set("o", outreachRecordId);
  url.searchParams.set("t", getUnsubscribeToken(outreachRecordId));
  return url.toString();
}

export function verifyUnsubscribeToken(
  outreachRecordId: string,
  sig: string | null
): boolean {
  if (!sig) return false;
  const expected = Buffer.from(getUnsubscribeToken(outreachRecordId));
  const provided = Buffer.from(sig);
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided);
}
