import "server-only";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string; // Critical for safe retries
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | Uint8Array | string;
  contentType?: string;
}

export interface SendEmailOutput {
  success: boolean;
  providerMessageId: string | null;
  error: string | null;
}

export interface IEmailProvider {
  send(input: SendEmailInput): Promise<SendEmailOutput>;
}