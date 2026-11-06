import crypto from "crypto";

/**
 * Pure webhook helpers shared by the provider webhook routes.
 *
 * Free of env/DB/network access so the event mapping and the signature checks
 * can be unit-tested directly.
 *
 * Webhooks exist for one reason: deliverability. A hard bounce or a spam
 * complaint that goes unnoticed poisons the sending domain until the provider
 * suspends it (which is exactly how the Brevo account was lost), so every
 * BOUNCED / COMPLAINED / unsubscribe event also suppresses the prospect.
 */

/**
 * Outcomes a webhook can record on an outreach record.
 *
 * DELIVERED / BOUNCED / COMPLAINED describe what happened to the message;
 * OPENED / CLICKED are engagement signals and never suppress anything.
 */
export type WebhookDeliveryOutcome =
  | "DELIVERED"
  | "BOUNCED"
  | "COMPLAINED"
  | "OPENED"
  | "CLICKED";

export interface MappedWebhookEvent {
  /** null = nothing to record on the outreach record (ignore the event). */
  outcome: WebhookDeliveryOutcome | null;
  /** true = the prospect must be suppressed so no future email goes out. */
  suppress: boolean;
  /** Reason stored with the suppression (e.g. "UNSUBSCRIBED"). */
  reason: string | null;
}

const IGNORED: MappedWebhookEvent = { outcome: null, suppress: false, reason: null };

function bounced(reason: string | null): MappedWebhookEvent {
  return { outcome: "BOUNCED", suppress: true, reason };
}

function complained(): MappedWebhookEvent {
  return { outcome: "COMPLAINED", suppress: true, reason: "COMPLAINED" };
}

function unsubscribed(): MappedWebhookEvent {
  return { outcome: null, suppress: true, reason: "UNSUBSCRIBED" };
}

/**
 * Mailgun event mapping. Mailgun's event names moved around over the years
 * ("bounced"/"dropped" on older accounts, "failed" + severity and
 * "permanent_fail" on newer ones), so every known spelling is covered.
 */
export function mapMailgunEvent(event: string, severity?: string): MappedWebhookEvent {
  const type = (event || "").toLowerCase();

  switch (type) {
    case "delivered":
      return { outcome: "DELIVERED", suppress: false, reason: null };
    case "permanent_fail":
    case "bounced":
    case "dropped":
      return bounced(type === "dropped" ? "DROPPED" : "BOUNCED");
    case "failed":
      // Temporary failures retry on their own — only permanent ones suppress.
      if ((severity || "").toLowerCase() === "temporary") return IGNORED;
      return bounced("BOUNCED");
    case "complained":
      return complained();
    case "unsubscribed":
      return unsubscribed();
    case "opened":
      // Engagement, not deliverability: record it, never suppress.
      return { outcome: "OPENED", suppress: false, reason: null };
    case "clicked":
      return { outcome: "CLICKED", suppress: false, reason: null };
    default:
      // accepted / temporary_fail — nothing to record here.
      return IGNORED;
  }
}

/** Mailtrap (Mailtop) event mapping — event names per Mailtrap's webhook docs. */
export function mapMailtrapEvent(event: string): MappedWebhookEvent {
  const type = (event || "").toLowerCase();

  switch (type) {
    case "delivery":
      return { outcome: "DELIVERED", suppress: false, reason: null };
    case "bounce":
      return bounced("BOUNCED");
    case "reject":
      // Mailtrap refused the message (suppression list / policy) — same net
      // effect as a bounce: this address must not be retried.
      return bounced("REJECTED");
    case "spam":
      return complained();
    case "unsubscribe":
      return unsubscribed();
    case "open":
      // Engagement, not deliverability: record it, never suppress.
      return { outcome: "OPENED", suppress: false, reason: null };
    case "click":
      return { outcome: "CLICKED", suppress: false, reason: null };
    default:
      // soft bounce / suspension — nothing to record here.
      return IGNORED;
  }
}

/** Mailgun refuses signatures older/newer than this — replay protection. */
export const MAILGUN_SIGNATURE_MAX_AGE_MS = 15 * 60 * 1000;

/**
 * Constant-time comparison of a hex HMAC-SHA256 against the recomputed one.
 * Tolerates an optional "sha256=" prefix and any letter casing.
 */
export function verifyHmacSha256Hex(
  secret: string,
  payload: string,
  providedHex: string
): boolean {
  if (!secret || !payload || !providedHex) return false;

  const provided = providedHex.trim().replace(/^sha256=/i, "").toLowerCase();
  const expected = crypto
    .createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

/**
 * Mailgun signs every webhook POST with HMAC-SHA256 of `timestamp + token`
 * using the account's Webhook Signing Key. The timestamp is also checked so a
 * captured request cannot be replayed later.
 */
export function verifyMailgunSignature(
  signingKey: string,
  timestamp: string,
  token: string,
  signature: string,
  nowMs: number = Date.now()
): boolean {
  if (!signingKey || !timestamp || !token || !signature) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs - ts * 1000) > MAILGUN_SIGNATURE_MAX_AGE_MS) return false;

  return verifyHmacSha256Hex(signingKey, `${timestamp}${token}`, signature);
}
