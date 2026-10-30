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

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Brevo transactional email (POST /v3/smtp/email).
 *
 * Brevo is the primary sender: its free tier carries 300 emails a day, three
 * times what the Resend plan allowed, so the pipeline reaches far more
 * prospects before it has to stop.
 *
 * Differences from Resend that matter here:
 *   - no `Idempotency-Key` header. The key travels as `X-Mailin-custom` (so it
 *     shows up in Brevo's logs) and duplicate protection stays where it really
 *     lives: the atomic outreach-state claim in outreachSendService.
 *   - attachments are base64 in a JSON body, not multipart.
 *   - the sender is `{ email, name }`, not a single "Name <addr>" string.
 */
export class BrevoEmailService implements IEmailProvider {
  readonly name: EmailProviderName = "brevo";

  isConfigured(): boolean {
    return Boolean(env.BREVO_API_KEY);
  }

  private get fromAddress(): string | undefined {
    return env.BREVO_FROM_EMAIL || env.RESEND_FROM_EMAIL;
  }

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    if (!env.BREVO_API_KEY) {
      return this.fail("BREVO_API_KEY is not configured.", "auth");
    }

    const from = this.fromAddress;
    if (!from) {
      return this.fail("No sender address configured (BREVO_FROM_EMAIL / RESEND_FROM_EMAIL).", "auth");
    }

    const payload: Record<string, unknown> = {
      sender: parseFromAddress(from),
      to: [{ email: input.to }],
      subject: input.subject,
      htmlContent: input.html,
      // Brevo's custom-header slot: keeps the idempotency key visible in the
      // Brevo dashboard when a duplicate send has to be investigated.
      headers: { "X-Mailin-custom": input.idempotencyKey },
    };

    if (input.text) payload.textContent = input.text;

    const attachments = input.attachments?.map(toBrevoAttachment);
    if (attachments?.length) payload.attachment = attachments;

    let response: Response;
    try {
      response = await fetch(BREVO_ENDPOINT, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "api-key": env.BREVO_API_KEY,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout or DNS/socket failure: the request may still have been
      // accepted, so this must NOT be retried through the other provider.
      const message = getErrorMessage(error);
      logger.error(`[BrevoEmailService] Network failure: ${message}`);
      return this.fail(`Brevo request failed: ${message}`, "transient");
    }

    const body = await readJson(response);

    if (!response.ok) {
      const providerMessage =
        (typeof body?.message === "string" && body.message) ||
        (typeof body?.error === "string" && body.error) ||
        `HTTP ${response.status}`;
      const kind = classifyBrevoError(response.status, providerMessage);

      logger.error(
        `[BrevoEmailService] Send rejected (${response.status}, ${kind}): ${providerMessage}`
      );

      return this.fail(`Brevo: ${providerMessage}`, kind);
    }

    const messageId = typeof body?.messageId === "string" ? body.messageId : null;
    logger.info(`[BrevoEmailService] Email accepted. Message ID: ${messageId ?? "(none returned)"}`);

    return { success: true, providerMessageId: messageId, provider: "brevo", error: null };
  }

  private fail(error: string, kind: EmailErrorKind): SendEmailOutput {
    return { success: false, providerMessageId: null, provider: "brevo", error, errorKind: kind };
  }
}

/**
 * Maps a Brevo status/message onto the router's retry vocabulary. Only "quota"
 * and "auth" are safe to retry on the other provider — a spent allowance or a
 * rejected key means nothing was sent.
 */
export function classifyBrevoError(status: number, message: string): EmailErrorKind {
  if (status === 401 || status === 403) return "auth";
  if (status === 402) return "quota";
  if (status === 429) return "quota";

  if (/quota|credit|limit reached|too many/i.test(message)) return "quota";
  if (/api[- ]?key|unauthor|not enabled|not allowed/i.test(message)) return "auth";
  if (status >= 500) return "transient";

  return "permanent";
}

function toBrevoAttachment(attachment: EmailAttachment): { name: string; content: string } {
  const content = attachment.content;

  if (typeof content === "string") {
    // Callers pass either a Buffer or an already-encoded base64 string.
    return { name: attachment.filename, content };
  }

  return {
    name: attachment.filename,
    content: Buffer.from(content).toString("base64"),
  };
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const brevoEmailService = new BrevoEmailService();
