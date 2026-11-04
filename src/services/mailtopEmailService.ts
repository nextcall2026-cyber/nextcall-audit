import "server-only";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { parseFromAddress } from "@/lib/emailRouting";
import {
  EmailAttachment,
  EmailErrorKind,
  IEmailProvider,
  SendEmailInput,
  SendEmailOutput,
} from "@/services/emailProvider";
import { EmailProviderName } from "@/types";

const DEFAULT_API_BASE = "https://send.api.mailtrap.io";
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Mailtop (Mailtrap.io) transactional email — POST {base}/api/send.
 *
 * Mailtop is the second sender of the day: its free tier carries 150 emails
 * (4,000/month, rejected above the daily line), and it only enters the plan
 * once Mailgun's 100 are spent. Resend covers the last 50.
 *
 * Differences from the other providers that matter here:
 *   - auth is the `Api-Token` header (Bearer also works; the token is
 *     per-domain and created in Mailtrap → Settings → API Tokens).
 *   - JSON payload, attachments as base64 strings.
 *   - the sender is `{ email, name }`, not a single "Name <addr>" string.
 *   - success returns `{ success: true, message_ids: [...] }` — one id per
 *     recipient, and we send to exactly one.
 *   - Mailtrap's edge protection blocks requests without a User-Agent, so one
 *     is always sent.
 */
export class MailtopEmailService implements IEmailProvider {
  readonly name: EmailProviderName = "mailtop";

  isConfigured(): boolean {
    return Boolean(env.MAILTOP_API_KEY);
  }

  private get fromAddress(): string | undefined {
    return env.MAILTOP_FROM_EMAIL || env.RESEND_FROM_EMAIL;
  }

  private get apiBase(): string {
    return (env.MAILTOP_BASE_URL || DEFAULT_API_BASE).trim().replace(/\/+$/, "");
  }

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    if (!env.MAILTOP_API_KEY) {
      return this.fail("MAILTOP_API_KEY is not configured.", "auth");
    }

    const from = this.fromAddress;
    if (!from) {
      return this.fail("No sender address configured (MAILTOP_FROM_EMAIL / RESEND_FROM_EMAIL).", "auth");
    }

    const payload: Record<string, unknown> = {
      from: parseFromAddress(from),
      to: [{ email: input.to }],
      subject: input.subject,
      // Keeps the idempotency key visible in Mailtrap's Email Logs when a
      // duplicate send has to be investigated.
      headers: { "X-NextCall-Idempotency": input.idempotencyKey },
      category: "outreach",
    };
    if (input.html) payload.html = input.html;
    if (input.text) payload.text = input.text;

    const attachments = input.attachments?.map(toMailtrapAttachment);
    if (attachments?.length) payload.attachments = attachments;

    let response: Response;
    try {
      response = await fetch(`${this.apiBase}/api/send`, {
        method: "POST",
        headers: {
          "Api-Token": env.MAILTOP_API_KEY,
          "content-type": "application/json",
          "user-agent": "nextcall-marketing-app",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout or DNS/socket failure: the request may still have been
      // accepted, so this must NOT be retried through the other provider.
      const message = getErrorMessage(error);
      logger.error(`[MailtopEmailService] Network failure: ${message}`);
      return this.fail(`Mailtop request failed: ${message}`, "transient");
    }

    const body = await readJson(response);

    if (!response.ok) {
      const providerMessage =
        (Array.isArray(body?.errors) && body.errors.filter(Boolean).join("; ")) ||
        (typeof body?.error === "string" && body.error) ||
        `HTTP ${response.status}`;
      const kind = classifyMailtopError(response.status, providerMessage);

      logger.error(
        `[MailtopEmailService] Send rejected (${response.status}, ${kind}): ${providerMessage}`
      );

      return this.fail(`Mailtop: ${providerMessage}`, kind);
    }

    if (body?.success === false) {
      // Unexpected shape (200 with success:false) — do not retry blindly.
      const message = Array.isArray(body?.errors) ? body.errors.join("; ") : "Mailtop reported failure";
      logger.error(`[MailtopEmailService] Send rejected (200, permanent): ${message}`);
      return this.fail(`Mailtop: ${message}`, "permanent");
    }

    const ids = Array.isArray(body?.message_ids) ? (body.message_ids as unknown[]) : [];
    const messageId = typeof ids[0] === "string" ? ids[0] : null;
    logger.info(`[MailtopEmailService] Email accepted. Message ID: ${messageId ?? "(none returned)"}`);

    return { success: true, providerMessageId: messageId, provider: "mailtop", error: null };
  }

  private fail(error: string, kind: EmailErrorKind): SendEmailOutput {
    return { success: false, providerMessageId: null, provider: "mailtop", error, errorKind: kind };
  }
}

/**
 * Maps a Mailtrap status/message onto the router's retry vocabulary. Only "quota"
 * and "auth" are safe to retry on the next provider — a spent allowance or a
 * rejected token means nothing was sent.
 */
export function classifyMailtopError(status: number, message: string): EmailErrorKind {
  // Free plan: 150 emails/day are rejected above the daily line; hourly
  // overflow is queued, so any hard "limit" answer is a stop-for-today signal.
  if (/limit|quota|exceed/i.test(message)) return "quota";
  if (status === 429) return "quota";
  if (status === 401 || status === 403) return "auth";
  if (/api[- ]?token|unauthor|forbidden|not allowed|verif/i.test(message)) return "auth";
  if (status >= 500) return "transient";

  return "permanent";
}

/** Mailtrap wants base64 content plus a MIME type per attachment. */
function toMailtrapAttachment(attachment: EmailAttachment): {
  content: string;
  filename: string;
  type: string;
  disposition: "attachment";
} {
  const content = attachment.content;

  // Callers pass either a Buffer/Uint8Array or an already-encoded base64 string.
  return {
    filename: attachment.filename,
    content:
      typeof content === "string"
        ? content
        : Buffer.from(content).toString("base64"),
    type: attachment.contentType || "application/octet-stream",
    disposition: "attachment",
  };
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const mailtopEmailService = new MailtopEmailService();
