import "server-only";
import { Resend } from "resend";
import { env } from "@/lib/env";

let resendClient: Resend | null = null;

export function getEmailClient(): Resend {
  if (!env.RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is not configured in environment variables.");
  }

  if (!resendClient) {
    resendClient = new Resend(env.RESEND_API_KEY);
  }

  return resendClient;
}