import "server-only";
import { z } from "zod";

const envSchema = z.object({
  // Database (Astra DB)
  ASTRA_DB_APPLICATION_TOKEN: z.string().optional(),
  ASTRA_DB_API_ENDPOINT: z.string().optional(),
  /** Plan storage allowance, used for the usage bar on the settings page. */
  ASTRA_STORAGE_LIMIT_MB: z.coerce.number().positive().optional().default(25600),

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

  // Email Outreach (Brevo) — primary sender, Resend becomes the overflow.
  // The key is a server secret: never expose it with NEXT_PUBLIC_.
  BREVO_API_KEY: z.string().optional(),
  /** "Name <email@domain>" or a bare address. Falls back to RESEND_FROM_EMAIL. */
  BREVO_FROM_EMAIL: z.string().optional(),
  /** Shared secret Brevo echoes back on webhook calls (?token=...). */
  BREVO_WEBHOOK_TOKEN: z.string().optional(),

  // Daily capacity per provider. Brevo's free tier allows 300/day and the
  // plan caps Resend at 50, so one day can carry 350 emails in total.
  EMAIL_DAILY_LIMIT_BREVO: z.coerce.number().int().nonnegative().optional().default(300),
  EMAIL_DAILY_LIMIT_RESEND: z.coerce.number().int().nonnegative().optional().default(50),

  // Authentication
  APP_PASSWORD: z.string().min(8, "APP_PASSWORD must be at least 8 characters"),

  // Public base URL used for email open-tracking pixels
  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  // Node environment
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
 });

/**
 * Parsed with safeParse so a misconfigured variable names itself instead of
 * surfacing as a blank 500 at every route that touches env. The thrown
 * message lists variable NAMES and validation messages only — never values.
 */
function parseEnv(): z.infer<typeof envSchema> {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `${issue.path.join(".") || "(env)"} — ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${problems}`);
  }

  return result.data;
}

export const env = parseEnv();
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