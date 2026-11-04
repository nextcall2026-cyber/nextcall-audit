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


  // Email Outreach (Mailgun) — first sender of the day, Mailtop and Resend
  // follow. The keys are server secrets: never expose them with NEXT_PUBLIC_.
  MAILGUN_API_KEY: z.string().optional(),
  /** Sending domain registered in Mailgun, e.g. getnextcall.com. */
  MAILGUN_DOMAIN: z.string().optional(),
  /** API base. US accounts: https://api.mailgun.net — EU: https://api.eu.mailgun.net. */
  MAILGUN_BASE_URL: z.string().url().optional(),
  /** "Name <email@domain>" or a bare address. Falls back to RESEND_FROM_EMAIL. */
  MAILGUN_FROM_EMAIL: z.string().optional(),

  // Email Outreach (Mailtop — Mailtrap.io) — second sender of the day.
  MAILTOP_API_KEY: z.string().optional(),
  /** Mailtrap sending API base. Default lives in the service. */
  MAILTOP_BASE_URL: z.string().url().optional(),
  /** Falls back to RESEND_FROM_EMAIL. */
  MAILTOP_FROM_EMAIL: z.string().optional(),

  // Webhook signing secrets (delivery / bounce / spam / unsubscribe events).
  // Mailgun: Settings → API Keys → Webhook Signing Key. Mailtrap: the signing
  // secret is shown when you create the webhook in Settings → Webhooks.
  MAILGUN_WEBHOOK_SIGNING_KEY: z.string().optional(),
  MAILTRAP_WEBHOOK_SIGNING_KEY: z.string().optional(),

  // Daily capacity per provider. Free tiers: Mailgun 100/day, Mailtrap
  // (Mailtop) 150/day (4,000/month), and the plan caps Resend at 50 — so one
  // day can carry 300 emails in total.
  EMAIL_DAILY_LIMIT_MAILGUN: z.coerce.number().int().nonnegative().optional().default(100),
  EMAIL_DAILY_LIMIT_MAILTOP: z.coerce.number().int().nonnegative().optional().default(150),
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
