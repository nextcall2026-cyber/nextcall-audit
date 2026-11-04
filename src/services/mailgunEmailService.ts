import "server-only";

import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import {
  EmailAttachment,
  EmailErrorKind,
  IEmailProvider,
  SendEmailInput,
  SendEmailOutput,
} from "@/services/emailProvider";
import { EmailProviderName } from "@/types";

const DEFAULT_API_BASE = "https://api.mailgun.net";
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Mailgun transactional email (POST /v3/{domain}/messages).
 *
 * Mailgun is the first sender of the day: its free tier carries 100 emails,
 * then Mailtop (Mailtrap) takes over with its 150, and Resend covers the last
 * 50.
 *
 * Differences from the other providers that matter here:
 *   - Basic auth (`api` : private API key), not a bearer token.
 *   - the payload is multipart/form-data — that is the only way to carry
 *     attachments. Text-only sends still go through the same form.
 *   - the sender stays a single "Name <addr>" string in the `from` field.
 *   - no native idempotency: the key travels as a custom header
 *     (`h:X-NextCall-Idempotency`) so it shows up in Mailgun logs; duplicate
 *     protection stays where it really lives: the atomic outreach-state claim
 *     in outreachSendService.
 *
 * SMTP (smtp.mailgun.org:587) is deliberately not used: Vercel blocks outbound
 * SMTP, so the app talks to Mailgun over its HTTPS API.
 */
export class MailgunEmailService implements IEmailProvider {
  readonly name: EmailProviderName = "mailgun";

  isConfigured(): boolean {
    return Boolean(env.MAILGUN_API_KEY && env.MAILGUN_DOMAIN);
  }

  private get fromAddress(): string | undefined {
    return env.MAILGUN_FROM_EMAIL || env.RESEND_FROM_EMAIL;
  }

  /** Accepts the marketing host in the env var and maps it onto the API host. */
  private get apiBase(): string {
    const raw = (env.MAILGUN_BASE_URL || DEFAULT_API_BASE).trim().replace(/\/+$/, "");
    return raw
      .replace("://mailgun.net", "://api.mailgun.net")
      .replace("://eu.mailgun.net", "://api.eu.mailgun.net");
  }

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    if (!env.MAILGUN_API_KEY) {
      return this.fail("MAILGUN_API_KEY is not configured.", "auth");
    }
    if (!env.MAILGUN_DOMAIN) {
      return this.fail("MAILGUN_DOMAIN is not configured.", "auth");
    }

    const from = this.fromAddress;
    if (!from) {
      return this.fail("No sender address configured (MAILGUN_FROM_EMAIL / RESEND_FROM_EMAIL).", "auth");
    }

    const form = new FormData();
    form.append("from", from);
    form.append("to", input.to);
    form.append("subject", input.subject);
    if (input.text) form.append("text", input.text);
    if (input.html) form.append("html", input.html);
    form.append("h:X-NextCall-Idempotency", input.idempotencyKey);

    for (const attachment of input.attachments ?? []) {
      form.append("attachment", toBlob(attachment), attachment.filename);
    }

    let response: Response;
    try {
      response = await fetch(`${this.apiBase}/v3/${env.MAILGUN_DOMAIN}/messages`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`api:${env.MAILGUN_API_KEY}`).toString("base64")}`,
          "user-agent": "nextcall-marketing-app",
        },
        body: form,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      // Timeout or DNS/socket failure: the request may still have been
      // accepted, so this must NOT be retried through the other provider.
      const message = getErrorMessage(error);
      logger.error(`[MailgunEmailService] Network failure: ${message}`);
      return this.fail(`Mailgun request failed: ${message}`, "transient");
    }

    const body = await readJson(response);

    if (!response.ok) {
      const providerMessage =
        (typeof body?.message === "string" && body.message) ||
        `HTTP ${response.status}`;
      const kind = classifyMailgunError(response.status, providerMessage);

      logger.error(
        `[MailgunEmailService] Send rejected (${response.status}, ${kind}): ${providerMessage}`
      );

      return this.fail(`Mailgun: ${providerMessage}`, kind);
    }

    const messageId = typeof body?.id === "string" ? body.id : null;
    logger.info(`[MailgunEmailService] Email accepted. Message ID: ${messageId ?? "(none returned)"}`);

    return { success: true, providerMessageId: messageId, provider: "mailgun", error: null };
  }

  private fail(error: string, kind: EmailErrorKind): SendEmailOutput {
    return { success: false, providerMessageId: null, provider: "mailgun", error, errorKind: kind };
  }
}

/**
 * Maps a Mailgun status/message onto the router's retry vocabulary. Only "quota"
 * and "auth" are safe to retry on the next provider — a spent allowance or a
 * rejected key means nothing was sent.
 */
export function classifyMailgunError(status: number, message: string): EmailErrorKind {
  if (/quota|daily sending limit|daily limit|limit reached|too many|rate limit/i.test(message)) {
    return "quota";
  }
  if (status === 402 || status === 429) return "quota";
  if (status === 401 || status === 403) return "auth";
  // 404 here means "domain not found" — a setup problem, nothing was sent.
  if (status === 404) return "auth";
  if (/api[- ]?key|unauthor|forbidden|not allowed|domain not found/i.test(message)) return "auth";
  if (status >= 500) return "transient";

  return "permanent";
}

/** Turns an EmailAttachment into a Blob file part for multipart/form-data. */
function toBlob(attachment: EmailAttachment): Blob {
  const content = attachment.content;

  // Callers pass either a Buffer/Uint8Array or an already-encoded base64 string.
  const bytes =
    typeof content === "string"
      ? Buffer.from(content, "base64")
      : Buffer.from(content);

  return new Blob([new Uint8Array(bytes)], {
    type: attachment.contentType || "application/octet-stream",
  });
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const mailgunEmailService = new MailgunEmailService();
