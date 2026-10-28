import { NextRequest, NextResponse } from "next/server";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { verifyUnsubscribeToken } from "@/lib/unsubscribe";
import { logger } from "@/lib/logger";

import { getErrorMessage } from "@/lib/errors";
import { notificationService } from "@/services/notificationService";

/**
 * Email unsubscribe endpoint (no auth — recipients click it from the email
 * footer). The link carries the outreach record id plus an HMAC token, so
 * only holders of the exact link can unsubscribe that prospect.
 *
 * GET  → shows a confirmation interstitial. Email clients sometimes prefetch
 *        links, so a plain GET must never suppress anyone.
 * POST → verifies the token again and permanently suppresses the prospect
 *        (isSuppressed + outreachState=UNSUBSCRIBED). The existing
 *        outreachSafetyService gate then blocks every future send —
 *        automated and manual.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function page(title: string, message: string, status: number, formHtml = ""): NextResponse {
  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} · NextCall</title>
  </head>
  <body style="margin:0; padding:24px; background:#f3f4f6; font-family:Arial, Helvetica, sans-serif;">
    <div style="max-width:420px; margin:48px auto; background:#ffffff; border:1px solid #e5e7eb; border-radius:12px; padding:28px; text-align:center;">
      <p style="margin:0 0 8px; font-size:12px; font-weight:bold; color:#6b7280; letter-spacing:1px;">NEXTCALL</p>
      <h1 style="margin:0 0 12px; font-size:20px; color:#111827;">${title}</h1>
      <p style="margin:0 0 20px; font-size:14px; line-height:1.6; color:#4b5563;">${message}</p>
      ${formHtml}
    </div>
  </body>
</html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const recordId = searchParams.get("o");
    const token = searchParams.get("t");

    if (!recordId || !token || !verifyUnsubscribeToken(recordId, token)) {
      return page(
        "Invalid link",
        "This unsubscribe link is invalid or has been modified. If you want to stop receiving emails, reply to the original email instead.",
        400
      );
    }

    const record = await outreachPersistenceService.getOutreachById(recordId);
    if (!record) {
      return page(
        "Link no longer valid",
        "We could not find the email this link belongs to. Nothing needs to be done — you will not be contacted from this sequence again.",
        404
      );
    }

    const safeRecordId = escapeHtml(recordId);
    const safeToken = escapeHtml(token);
    const formHtml = `
      <form method="post" action="/api/tracking/unsubscribe">
        <input type="hidden" name="o" value="${safeRecordId}" />
        <input type="hidden" name="t" value="${safeToken}" />
        <input type="hidden" name="confirm" value="1" />
        <button type="submit" style="display:inline-block; padding:10px 28px; background:#dc2626; color:#ffffff; border:0; border-radius:999px; font-size:14px; font-weight:bold; cursor:pointer;">
          Confirm Unsubscribe
        </button>
      </form>`;

    return page(
      "Unsubscribe from NextCall emails",
      "Click the button below to stop receiving all future emails from NextCall for this address. This cannot be undone.",
      200,
      formHtml
    );
  } catch (error) {
    logger.error("[API /unsubscribe] GET failed:", getErrorMessage(error));
    return page("Something went wrong", "Please try again in a moment.", 500);
  }
}

export async function POST(request: NextRequest) {
  try {
    const form = await request.formData();
    const recordId = form.get("o");
    const token = form.get("t");
    const confirm = form.get("confirm");

    if (
      typeof recordId !== "string" ||
      typeof token !== "string" ||
      confirm !== "1" ||
      !verifyUnsubscribeToken(recordId, token)
    ) {
      return page(
        "Invalid request",
        "This unsubscribe confirmation is invalid or incomplete. Please use the link from the original email.",
        400
      );
    }

    const record = await outreachPersistenceService.getOutreachById(recordId);
    if (!record) {
      return page(
        "Link no longer valid",
        "We could not find the email this link belongs to. You will not be contacted from this sequence again.",
        404
      );
    }

    await prospectPersistenceService.updateSuppression(record.prospectId, true, "UNSUBSCRIBED");
    await prospectPersistenceService.updateOutreachState(record.prospectId, "UNSUBSCRIBED");
    logger.info(`[API /unsubscribe] Prospect ${record.prospectId} unsubscribed via outreach record ${recordId}.`);

    await notificationService.notify({
      type: "UNSUBSCRIBED",
      title: "Someone unsubscribed",
      body: `${record.recipient} opted out — sequence stopped and future emails suppressed.`,
      href: `/dashboard/pipeline/${record.prospectId}`,
      prospectId: record.prospectId,
      businessId: record.businessId,
      dedupeKey: `unsubscribed:${record.prospectId}`,
    });

    return page(
      "You're unsubscribed",
      "This email address has been removed from all future NextCall emails — including any scheduled follow-ups. Sorry to see you go!",
      200
    );
  } catch (error) {
    logger.error("[API /unsubscribe] POST failed:", getErrorMessage(error));
    return page("Something went wrong", "Please try again in a moment.", 500);
  }
}
