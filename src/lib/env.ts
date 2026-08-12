import "server-only";
import { z } from "zod";

const envSchema = z.object({
  // Database (Astra DB)
  ASTRA_DB_APPLICATION_TOKEN: z.string().optional(),
  ASTRA_DB_API_ENDPOINT: z.string().optional(),

  // AI Provider (OpenAI)
  OPENAI_API_KEY: z.string().optional(),

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