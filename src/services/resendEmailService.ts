import "server-only";

import { env } from "@/lib/env";
import { getEmailClient } from "@/lib/email";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import {
  EmailErrorKind,
  IEmailProvider,
  SendEmailInput,
  SendEmailOutput,
} from "@/services/emailProvider";
import { EmailProviderName } from "@/types";

/**
 * Resend — the overflow sender.
 *
 * Resend carries 50 of the 350 daily emails: everything Brevo could not take
 * once its 300/day allowance is spent. The call itself is unchanged from the
 * original single-provider implementation (same payload, same Idempotency-Key
 * header), only wrapped in the provider interface so the router can pick it.
 */
export class ResendEmailService implements IEmailProvider {
  readonly name: EmailProviderName = "resend";

  isConfigured(): boolean {
    return Boolean(env.RESEND_API_KEY);
  }

  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    if (!env.RESEND_API_KEY) {
      return this.fail("RESEND_API_KEY is not configured.", "auth");
    }
    if (!env.RESEND_FROM_EMAIL) {
      return this.fail("RESEND_FROM_EMAIL is not configured.", "auth");
    }

    try {
      const client = getEmailClient();

      const { data, error } = await client.emails.send(
        {
          from: env.RESEND_FROM_EMAIL,
          to: input.to,
          subject: input.subject,
          html: input.html,
          ...(input.text ? { text: input.text } : {}),
          attachments: input.attachments?.map((a) => ({
            filename: a.filename,
            content:
              a.content instanceof Uint8Array && !Buffer.isBuffer(a.content)
                ? Buffer.from(a.content)
                : a.content,
            ...(a.contentType ? { contentType: a.contentType } : {}),
          })),
        },
        { headers: { "Idempotency-Key": input.idempotencyKey } }
      );

      if (error) {
        const message = error.message || "Unknown Resend error";
        const kind = classifyResendError(message);
        logger.error(`[ResendEmailService] Send rejected (${kind}): ${message}`);
        return this.fail(`Resend: ${message}`, kind);
      }

      logger.info(`[ResendEmailService] Email accepted. Message ID: ${data?.id}`);
      return { success: true, providerMessageId: data?.id ?? null, provider: "resend", error: null };
    } catch (err) {
      // Thrown after the request left the process — do not retry elsewhere.
      const message = getErrorMessage(err);
      logger.error(`[ResendEmailService] Unexpected error: ${message}`);
      return this.fail(`Resend: ${message}`, "transient");
    }
  }

  private fail(error: string, kind: EmailErrorKind): SendEmailOutput {
    return { success: false, providerMessageId: null, provider: "resend", error, errorKind: kind };
  }
}

export function classifyResendError(message: string): EmailErrorKind {
  if (/quota|rate limit|too many requests|429/i.test(message)) return "quota";
  if (/api key|unauthor|forbidden|401|403/i.test(message)) return "auth";
  if (/timeout|network|ECONNRESET|ETIMEDOUT|5\d\d/i.test(message)) return "transient";
  return "permanent";
}

export const resendEmailService = new ResendEmailService();
