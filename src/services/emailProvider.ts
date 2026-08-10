import "server-only";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  idempotencyKey: string; // Critical for safe retries
}

export interface SendEmailOutput {
  success: boolean;
  providerMessageId: string | null;
  error: string | null;
}

export interface IEmailProvider {
  send(input: SendEmailInput): Promise<SendEmailOutput>;
}