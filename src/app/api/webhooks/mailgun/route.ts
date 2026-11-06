import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import {
  MappedWebhookEvent,
  mapMailgunEvent,
  verifyMailgunSignature,
} from "@/lib/webhookEvents";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";

/**
 * Mailgun delivery webhook.
 *
 * Register in Mailgun (Sending → Webhooks, domain getnextcall.com) for the
 * Delivered / Permanent Fail / Spam Complaints / Unsubscribed events, all
 * pointing at:
 *   https://<app>/api/webhooks/mailgun
 *
 * Mailgun signs every POST: HMAC-SHA256 of `timestamp + token` with the
 * account's Webhook Signing Key (Settings → API Keys). Requests with a bad or
 * stale signature are refused rather than trusted.
 *
 * Events that change our state:
 *   delivered                            → DELIVERED
 *   permanent_fail / bounced / dropped   → BOUNCED  + suppress the prospect
 *   failed (severity permanent)          → BOUNCED  + suppress the prospect
 *   complained                           → COMPLAINED + suppress the prospect
 *   unsubscribed                         → suppress the prospect
 *   opened / clicked                     → OPENED / CLICKED on the outreach record
 *   accepted / temporary fail            → ignored
 */

interface MailgunFields {
  timestamp: string;
  token: string;
  signature: string;
  event: string;
  messageId: string;
  severity?: string;
  reason: string | null;
}

export async function POST(request: NextRequest) {
  try {
    if (!env.MAILGUN_WEBHOOK_SIGNING_KEY) {
      logger.error("[API /webhooks/mailgun] Missing MAILGUN_WEBHOOK_SIGNING_KEY in env");
      return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
    }

    const fields = await readFields(request);
    if (!fields) {
      return NextResponse.json({ error: "Invalid webhook body" }, { status: 400 });
    }

    if (
      !verifyMailgunSignature(
        env.MAILGUN_WEBHOOK_SIGNING_KEY,
        fields.timestamp,
        fields.token,
        fields.signature
      )
    ) {
      logger.warn("[API /webhooks/mailgun] Rejected webhook with an invalid signature");
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const type = fields.event;
    logger.info(`[API /webhooks/mailgun] Received event: ${type || "(none)"}`);

    const mapped = mapMailgunEvent(type, fields.severity);
    if (mapped.outcome === null && !mapped.suppress) {
      return NextResponse.json({ success: true, processed: 0 });
    }

    // Opens and clicks are engagement, not deliverability: they land in the
    // pipeline's OPENED / CLICKED boxes and never suppress anyone.
    if (mapped.outcome === "OPENED" || mapped.outcome === "CLICKED") {
      const handled = fields.messageId
        ? await markEngagement(fields.messageId, mapped.outcome)
        : false;
      return NextResponse.json({ success: true, processed: handled ? 1 : 0 });
    }

    let prospectId: string | null = null;

    if (mapped.outcome && fields.messageId) {
      prospectId = await updateDelivery(fields.messageId, mapped.outcome, fields.reason);
    }

    if (mapped.suppress) {
      const targetId = prospectId ?? (await suppressByMessageId(fields.messageId));
      if (targetId) {
        await prospectPersistenceService.updateSuppression(targetId, true, mapped.reason ?? "BOUNCED");
      }
    }

    return NextResponse.json({ success: true, processed: 1 });
  } catch (error) {
    logger.error("[API /webhooks/mailgun] Webhook processing failed:", getErrorMessage(error));
    return NextResponse.json({ error: "Webhook processing failed" }, { status: 500 });
  }
}

/**
 * Mailgun posts form-encoded fields by default; a few account shapes use
 * JSON. Both are read here so a dashboard toggle cannot break the endpoint.
 */
async function readFields(request: NextRequest): Promise<MailgunFields | null> {
  const contentType = request.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    const json = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!json) return null;

    const sig = (json.signature ?? {}) as Record<string, unknown>;
    const data = (json["event-data"] ?? json) as Record<string, unknown>;

    return {
      timestamp: String(sig.timestamp ?? json.timestamp ?? ""),
      token: String(sig.token ?? json.token ?? ""),
      signature: String(sig.signature ?? json.signature ?? ""),
      event: String(data.event ?? ""),
      messageId: String(data["Message-Id"] ?? data["message-id"] ?? data.messageId ?? ""),
      severity: typeof data.severity === "string" ? data.severity : undefined,
      reason: typeof data.reason === "string" ? data.reason : null,
    };
  }

  const rawBody = await request.text();
  const params = new URLSearchParams(rawBody);

  return {
    timestamp: params.get("timestamp") ?? "",
    token: params.get("token") ?? "",
    signature: params.get("signature") ?? "",
    event: params.get("event") ?? "",
    messageId:
      params.get("Message-Id") ?? params.get("message-id") ?? params.get("messageId") ?? "",
    severity: params.get("severity") ?? undefined,
    reason: params.get("reason") ?? params.get("error"),
  };
}

/**
 * Mailgun echoes the message id with or without the angle brackets its send
 * API returns, so both forms are tried before giving up.
 */
async function updateDelivery(
  messageId: string,
  status: MappedWebhookEvent["outcome"] & ("DELIVERED" | "BOUNCED" | "COMPLAINED"),
  reason: string | null
): Promise<string | null> {
  const variants = new Set([
    messageId,
    messageId.replace(/^<|>$/g, ""),
    `<${messageId.replace(/^<|>$/g, "")}>`,
  ]);

  for (const candidate of variants) {
    if (!candidate) continue;
    const prospectId = await outreachPersistenceService.updateDeliveryStatus(candidate, status, reason);
    if (prospectId) return prospectId;
  }

  return null;
}

async function suppressByMessageId(messageId: string): Promise<string | null> {
  if (!messageId) return null;

  const variants = new Set([
    messageId,
    messageId.replace(/^<|>$/g, ""),
    `<${messageId.replace(/^<|>$/g, "")}>`,
  ]);

  for (const candidate of variants) {
    if (!candidate) continue;
    const record = await outreachPersistenceService.findByMessageId(candidate);
    if (record) return record.prospectId;
  }

  return null;
}

/**
 * Stamps an open or a click on the outreach record behind a message id,
 * tolerating the angle-bracket variants Mailgun returns.
 */
async function markEngagement(
  messageId: string,
  outcome: "OPENED" | "CLICKED"
): Promise<boolean> {
  const variants = new Set([
    messageId,
    messageId.replace(/^<|>$/g, ""),
    `<${messageId.replace(/^<|>$/g, "")}>`,
  ]);

  for (const candidate of variants) {
    if (!candidate) continue;
    const record = await outreachPersistenceService.findByMessageId(candidate);
    if (!record) continue;

    if (outcome === "OPENED") await outreachPersistenceService.markOpened(record.id);
    else await outreachPersistenceService.markClicked(record.id);
    return true;
  }

  return false;
}
