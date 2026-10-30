import "server-only";

import { EmailProviderName } from "@/types";
import { ProviderCapacity } from "@/lib/emailRouting";

export interface SendEmailInput {
  to: string;
  subject: string;
  html: string;
  /** Plain-text alternative — improves deliverability (avoids HTML-only penalty) */
  text?: string;
  idempotencyKey: string; // Critical for safe retries
  attachments?: EmailAttachment[];
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | Uint8Array | string;
  contentType?: string;
}

/**
 * Why a send failed, which decides whether the router may hand the same email
 * to the next provider:
 *   - "quota"     the provider is out of daily allowance / rate limited → try the next one
 *   - "auth"      the key is missing or rejected → try the next one
 *   - "transient" 5xx or timeout — the email MAY have gone out → do not retry
 *   - "permanent" the request itself is invalid → do not retry
 */
export type EmailErrorKind = "quota" | "auth" | "transient" | "permanent";

export interface SendEmailOutput {
  success: boolean;
  providerMessageId: string | null;
  /** Which provider carried the email (null when every provider failed). */
  provider: EmailProviderName | null;
  error: string | null;
  /** Set on failure so the router knows if a fallback send is safe. */
  errorKind?: EmailErrorKind;
}

export interface IEmailProvider {
  readonly name: EmailProviderName;
  /** False when the provider has no credentials configured. */
  isConfigured(): boolean;
  send(input: SendEmailInput): Promise<SendEmailOutput>;
}

/**
 * Everything the router needs from the quota store. Kept as an interface so the
 * routing rules can be tested with a fake budget and no database.
 */
export interface QuotaGateway {
  getSendPlan(): Promise<EmailProviderName[]>;
  getCapacities(): Promise<ProviderCapacity[]>;
  record(name: EmailProviderName): Promise<void>;
  markExhausted(name: EmailProviderName): Promise<void>;
}
