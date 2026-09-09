/**
 * NEXT CALL product links used by the audit PDF CTAs.
 *
 * Client-safe (no server-only imports) so it can be used by the
 * report components and tests alike. Overridable via environment:
 *   NEXT_PUBLIC_NEXTCALL_URL        — main website
 *   NEXT_PUBLIC_NEXTCALL_TRIAL_URL  — trial / signup landing page
 *
 * Both fall back to the confirmed production URLs.
 */

const DEFAULT_NEXTCALL_URL = "https://getnextcall.com/";
const DEFAULT_NEXTCALL_TRIAL_URL = "https://getnextcall.com/";

export const NEXTCALL_URL: string =
  process.env.NEXT_PUBLIC_NEXTCALL_URL?.trim() || DEFAULT_NEXTCALL_URL;

export const NEXTCALL_TRIAL_URL: string =
  process.env.NEXT_PUBLIC_NEXTCALL_TRIAL_URL?.trim() || DEFAULT_NEXTCALL_TRIAL_URL;

/** True when the product actually offers a 3-day free trial (drives CTA copy). */
export const NEXTCALL_OFFERS_TRIAL = true;