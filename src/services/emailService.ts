import "server-only";
import { getEmailClient } from "@/lib/email";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { ApplicationError } from "@/lib/errors";
import { IEmailProvider, SendEmailInput, SendEmailOutput } from "@/services/emailProvider";

export class EmailService implements IEmailProvider {
  async send(input: SendEmailInput): Promise<SendEmailOutput> {
    if (!env.RESEND_FROM_EMAIL) {
      throw new ApplicationError("RESEND_FROM_EMAIL is not configured.", "CONFIG_ERROR");
    }

    const client = getEmailClient();

    try {
      logger.info(`[EmailService] Sending email to ${input.to} with key ${input.idempotencyKey}...`);
      
      // Pass the Idempotency-Key header to Resend
      const { data, error } = await client.emails.send({
        from: env.RESEND_FROM_EMAIL,
        to: input.to,
        subject: input.subject,
        html: input.html,
        attachments: input.attachments?.map(a => ({
          filename: a.filename,
          content: a.content instanceof Uint8Array && !Buffer.isBuffer(a.content)
            ? Buffer.from(a.content)
            : a.content,
          ...(a.contentType ? { contentType: a.contentType } : {}),
        })),
      }, {
        headers: {
          'Idempotency-Key': input.idempotencyKey
        }
      });

      if (error) {
        logger.error(`[EmailService] Resend API error: ${error.message}`);
        return { success: false, providerMessageId: null, error: error.message };
      }

      logger.info(`[EmailService] Email accepted by Resend. Message ID: ${data?.id}`);
      return { success: true, providerMessageId: data?.id || null, error: null };

    } catch (err: any) {
      logger.error(`[EmailService] Unexpected error sending email: ${err.message}`);
      return { success: false, providerMessageId: null, error: err.message };
    }
  }
}

export const emailService = new EmailService();