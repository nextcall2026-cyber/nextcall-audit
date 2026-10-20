import "server-only";
import { z } from "zod";

const envSchema = z.object({
  // Database (Astra DB)
  ASTRA_DB_APPLICATION_TOKEN: z.string().optional(),
  ASTRA_DB_API_ENDPOINT: z.string().optional(),

  // AI Providers — primary: Google Gemini, automatic fallback: OpenAI
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().optional(),

  // Business Discovery Providers
  SERPAPI_API_KEY: z.string().optional(),
  SERPAPI_MAX_DISCOVERY_RESULTS: z.coerce.number().positive().optional().default(100),
  APIFY_API_TOKEN: z.string().optional(),
  APIFY_ACTOR_ID: z.string().optional(),
  APIFY_MAX_DISCOVERY_RESULTS: z.coerce.number().positive().optional().default(50),
  TOMTOM_API_KEY: z.string().optional(),
  TOMTOM_MAX_REQUESTS_PER_DAY: z.coerce.number().positive().optional().default(1000),
  GEOAPIFY_API_KEY: z.string().optional(),
  GEOAPIFY_MAX_REQUESTS_PER_DAY: z.coerce.number().positive().optional().default(3000),

  // Email Outreach (Resend) --- NEW ---
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_EMAIL: z.string().email().optional(),
 
  //Email Outreach (Resend) 
  RESEND_WEBHOOK_SECRET: z.string().optional(), // NEW

  // Authentication
  APP_PASSWORD: z.string().min(8, "APP_PASSWORD must be at least 8 characters"),

  // Public base URL used for email open-tracking pixels
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // Node environment
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
 });

export const env = envSchema.parse(process.env);
export type Env = z.infer<typeof envSchema>;

/**
 * Public base URL for links embedded in outbound emails (open-tracking
 * pixel, unsubscribe link, etc.).
 *
 * Resolution order:
 * 1. NEXT_PUBLIC_APP_URL — explicit override. Set this in the Vercel
 *    project's Environment Variables (e.g. https://audit-next-call.vercel.app),
 *    and change it if the app moves to a custom domain.
 * 2. VERCEL_PROJECT_PRODUCTION_URL / VERCEL_URL — injected automatically by
 *    Vercel on every deployment, so production emails carry real https
 *    links instead of a localhost fallback even without explicit config.
 * 3. http://localhost:3000 — local development only.
 */
export function getPublicBaseUrl(): string {
  const explicit = env.NEXT_PUBLIC_APP_URL;
  if (explicit) return explicit.replace(/\/+$/, "");

  const vercelHost =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercelHost) {
    return `https://${vercelHost
      .replace(/^https?:\/\//, "")
      .replace(/\/+$/, "")}`;
  }

  return "http://localhost:3000";
}