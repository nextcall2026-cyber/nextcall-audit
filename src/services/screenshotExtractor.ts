import "server-only";

import { z } from "zod";
import { generateLLMResponse } from "@/lib/ai";
import { AI_CHAINS } from "@/lib/ai/chains";
import { isChainSlow, recordChainTiming } from "@/lib/ai/chainHealth";
import { logger } from "@/lib/logger";

/**
 * Reads business details out of the two screenshots the operator supplies:
 *
 *   - "google"   — the Google Business Profile listing (name, phone, website,
 *                  address, rating, review count, category)
 *   - "facebook" — the Facebook Page "About / Intro" panel. This one matters
 *                  most for the email address: ~95% of pages show one there,
 *                  while only ~20% of small-business websites do.
 *
 * The image is never stored — it is read here and dropped, which is why the
 * app needs no blob storage and no cleanup job.
 */

export type ScreenshotKind = "google" | "facebook";

const ExtractedSchema = z.object({
  name: z.string().nullish(),
  phone: z.string().nullish(),
  website: z.string().nullish(),
  address: z.string().nullish(),
  rating: z.number().min(0).max(5).nullish(),
  reviewCount: z.number().int().min(0).nullish(),
  category: z.string().nullish(),
  email: z.string().nullish(),
  services: z.array(z.string()).nullish(),
  hours: z.string().nullish(),
});

export type ExtractedScreenshotFields = z.infer<typeof ExtractedSchema>;

const GOOGLE_PROMPT = `You extract business details from a screenshot of a Google Maps (or similar map directory) business listing.

Rules:
- Extract ONLY text and values that are clearly visible in the screenshot. Never guess or infer.
- "name" is the business name shown in the listing.
- "phone" is the phone number exactly as shown (digits, spaces and dashes allowed).
- "website" is the website URL shown in the listing. Return it with scheme if present, otherwise as-is (e.g. jlplumbing.com).
- "address" is the full street address shown.
- "rating" is the star rating as a number between 0 and 5 (e.g. 4.7).
- "reviewCount" is the number of reviews shown (e.g. 123 from "4.7 (123)").
- "category" is the business type/category if shown (e.g. Plumber, Restaurant, Salon).
- "email" is an email address if one is visible anywhere in the screenshot.
- If a field is not visible, return null for it. Do NOT invent values.
- Return ONLY a JSON object with keys: name, phone, website, address, rating, reviewCount, category, email, services, hours.`;

const FACEBOOK_PROMPT = `You extract business details from a screenshot of a Facebook Page's "About", "Intro" or "Details" section.

Rules:
- Extract ONLY text and values that are clearly visible. Never guess or infer.
- "email" is THE MOST IMPORTANT field. Look for an address in the contact details, the intro text, or anywhere else on the page. Return it exactly as printed.
- "name" is the page/business name shown at the top.
- "phone" is a phone number if the page lists one.
- "website" is a website link if the page lists one.
- "address" is a street address or "Located in ..." text if shown.
- "category" is the page category (e.g. "Landscaper", "Plumber", "Home service").
- "services" is a list of services the page mentions, as short phrases (e.g. ["Landscape design", "Hardscaping"]).
- "hours" is the opening hours as one line if shown.
- "rating" and "reviewCount" are the star rating and number of reviews if shown (e.g. 4.9 and 12).
- If a field is not visible, return null for it. Do NOT invent values.
- Return ONLY a JSON object with keys: name, phone, website, address, rating, reviewCount, category, email, services, hours.`;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/**
 * How long the primary chain gets on its own before the other vision chain is
 * asked as well.
 *
 * Measured on production: auto:vision-social answers a screenshot in ~1.5-7s
 * while auto:vision-listing can take 40-95s. Waiting out the slow one costs the
 * operator a minute per business, so after a few seconds we simply ask the
 * other chain too and take whichever answers first. In the normal case the
 * primary wins inside the head start and the second call never happens.
 */
const HEDGE_DELAY_MS = 4_000;

/**
 * Rate limits are worth waiting out: the router reports exactly when its
 * routes free up ("Soonest reset ~4s"), and every model in the chain being
 * briefly limited is a normal, self-clearing condition — not a reason to send
 * the operator back to take another screenshot.
 */
const MAX_RATE_LIMIT_RETRIES = 2;
const RATE_LIMIT_MEMORY_MS = 60_000;

/** How long the router asked us to wait, in ms; null when it is not a 429. */
function rateLimitWaitMs(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (!/429|rate.?limit|routing_exhausted|models exhausted/i.test(message)) return null;

  const match = /reset\s*(?:~|in|after)?\s*(\d+(?:\.\d+)?)\s*s/i.exec(message);
  const seconds = match ? Number(match[1]) : 5;
  return Math.min(10_000, Math.max(1_000, Math.round(seconds * 1000) + 500));
}

export class ScreenshotError extends Error {
  readonly userMessage: string;
  readonly status: number;

  constructor(userMessage: string, status = 422) {
    super(userMessage);
    this.name = "ScreenshotError";
    this.userMessage = userMessage;
    this.status = status;
  }
}

/** Both vision chains, in the order to try them for this screenshot type. */
function chainsFor(kind: ScreenshotKind): [string, string] {
  const [primary, backup] =
    kind === "google"
      ? [AI_CHAINS.visionListing, AI_CHAINS.visionSocial]
      : [AI_CHAINS.visionSocial, AI_CHAINS.visionListing];

  // If the leading chain was slow or failing within the last few minutes, lead
  // with the other one instead. The hedge would rescue the read anyway, but
  // this way a stuck chain costs nothing rather than a 6s head start per
  // upload. When its memory expires it gets to lead again.
  if (isChainSlow(primary) && !isChainSlow(backup)) return [backup, primary];
  return [primary, backup];
}

/** One read. Returns null when the reply was not usable JSON; throws on failure. */
async function readOnce(
  kind: ScreenshotKind,
  bytes: Buffer,
  mimeType: string,
  model: string,
  timeoutMs: number
): Promise<ExtractedScreenshotFields | null> {
  const label = kind === "google" ? "Google Business Profile" : "Facebook About";

  const llm = await generateLLMResponse({
    system: kind === "google" ? GOOGLE_PROMPT : FACEBOOK_PROMPT,
    user: `Extract the business details from this ${label} screenshot. If a field is not visible, return null for it.`,
    images: [{ mimeType, data: bytes.toString("base64") }],
    temperature: 0,
    maxOutputTokens: 1200,
    json: true,
    thinking: "off",
    model,
    timeoutMs,
    // The upload has a hard time budget: the gateway's extra 2s-delayed retry
    // would turn one timeout into two and blow the request.
    singleAttempt: true,
  });

  if (!llm.text) return null;

  try {
    const result = ExtractedSchema.safeParse(JSON.parse(llm.text));
    if (result.success) return result.data;
    logger.warn(`[ScreenshotExtractor] ${label}: reply did not match the schema.`);
  } catch {
    logger.warn(`[ScreenshotExtractor] ${label}: unreadable JSON.`);
  }
  return null;
}

/** Resolves with the first non-null value; null only when every input is null. */
function firstSuccess<T>(promises: Array<Promise<T | null>>): Promise<T | null> {
  return new Promise((resolve) => {
    let pending = promises.length;
    let settled = false;

    const finish = (value: T | null) => {
      pending -= 1;
      if (settled) return;
      if (value) {
        settled = true;
        resolve(value);
      } else if (pending === 0) {
        settled = true;
        resolve(null);
      }
    };

    for (const promise of promises) {
      promise.then(finish).catch(() => finish(null));
    }
  });
}

export async function extractFromScreenshot(
  kind: ScreenshotKind,
  file: File,
  options: { timeoutMs?: number } = {}
): Promise<ExtractedScreenshotFields> {
  if (!file.type.startsWith("image/")) {
    throw new ScreenshotError("One of the uploaded files is not an image. Use PNG, JPG or WEBP.", 400);
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new ScreenshotError("That screenshot is larger than 8 MB. Please use a smaller image.", 400);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const label = kind === "google" ? "Google Business Profile" : "Facebook About";
  const budget = options.timeoutMs ?? 30_000;
  const [primaryChain, backupChain] = chainsFor(kind);

  let lastError: unknown = null;
  const run = async (model: string, timeoutMs: number) => {
    const startedAt = Date.now();
    const deadline = startedAt + timeoutMs;

    for (let attempt = 0; ; attempt++) {
      const remaining = Math.max(5_000, deadline - Date.now());
      try {
        const fields = await readOnce(kind, bytes, file.type, model, remaining);
        // An unusable reply still means the chain answered — that is a content
        // problem, not a slow chain.
        recordChainTiming(model, Date.now() - startedAt, true);
        return fields;
      } catch (error) {
        lastError = error;
        const waitMs = rateLimitWaitMs(error);

        // A rate limit is not a broken chain: the router says when its routes
        // free up ("Soonest reset ~4s"), so wait exactly that long and try
        // again instead of failing the upload.
        if (waitMs === null || attempt >= MAX_RATE_LIMIT_RETRIES || Date.now() + waitMs >= deadline) {
          recordChainTiming(
            model,
            Date.now() - startedAt,
            false,
            waitMs === null ? undefined : RATE_LIMIT_MEMORY_MS
          );
          logger.warn(
            `[ScreenshotExtractor] ${label} via ${model} failed — ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          return null;
        }

        logger.warn(
          `[ScreenshotExtractor] ${label} via ${model} is rate limited — retrying in ${waitMs}ms.`
        );
        await new Promise((resolve) => setTimeout(resolve, waitMs));
      }
    }
  };

  // The primary gets a head start. If it is still thinking when the timer
  // fires, the other vision chain is asked as well — whichever answers first
  // wins. `done` stops the second call when the first one was quick.
  let done = false;
  const primaryRun = run(primaryChain, budget);
  const backupRun = new Promise<ExtractedScreenshotFields | null>((resolve) => {
    setTimeout(() => {
      if (done) resolve(null);
      else void run(backupChain, Math.max(10_000, budget - HEDGE_DELAY_MS)).then(resolve);
    }, HEDGE_DELAY_MS);
  });

  const parsed = await firstSuccess([primaryRun, backupRun]);
  done = true;

  if (!parsed) {
    throw new ScreenshotError(describeFailure(label, lastError));
  }

  return parsed;
}

/**
 * Turns the raw failure into something the operator can act on.
 *
 * "Take a clearer screenshot" is the wrong advice when the image was fine and
 * the image reader was simply still starting up — that is what a cold router
 * looks like, and pressing the button again a few seconds later works.
 */
function describeFailure(label: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (/429|rate.?limit|models exhausted|routing_exhausted/i.test(message)) {
    return `All the AI models are briefly busy (free-tier rate limit), so the ${label} screenshot was not read. Wait about ten seconds and press "Add to queue" again — nothing is wrong with the screenshot.`;
  }

  // Everything in here means "the reader could not answer right now", not
  // "your screenshot is bad". A timeout, a sleeping/starting server, a
  // provider parked by the circuit breaker — all the same advice: retry.
  const temporary =
    /no response|timed out|timeout|aborted|within \d+ms|fetch failed|ECONNRESET|cooling down|skipped|all llm providers failed|unavailable|503|502|504/i.test(
      message
    );

  if (temporary) {
    return `The AI vision models did not answer in time, so the ${label} screenshot was not read. The screenshot itself is fine — this is the AI side. Wait a few seconds and press "Add to queue" again. If it keeps happening, open FreeLLMAPI and check the vision chains (auto:vision-listing / auto:vision-social): a model that accepts the request but never replies blocks the whole chain, so remove it or move a faster model to the top.`;
  }

  return `The ${label} screenshot could not be read. Take a clearer screenshot (make sure the business name and contact details are visible) and try again.`;
}

/** Trims a value and turns blanks into null. */
export function cleanValue(value: string | null | undefined): string | null {
  const trimmed = (value ?? "").trim();
  return trimmed.length > 0 ? trimmed : null;
}
