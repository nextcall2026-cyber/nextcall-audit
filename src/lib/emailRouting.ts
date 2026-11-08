import { EmailProviderName } from "@/types";

/**
 * Pure routing rules for the three-provider sending setup.
 *
 * The day is split across the free tiers in this order:
 *   1. Mailgun   — first 100 emails (free tier)
 *   2. Mailtop   — next 150 emails (Mailtrap.io free tier, 150/day)
 *   3. Resend    — the last 50 emails (overflow)
 *
 * SLOT: a fourth provider will take the place of Resend later — add its
 * service, its env limit, and insert its name into EMAIL_PROVIDER_ORDER at
 * Resend's position. The rest of the pipeline needs no changes.
 *
 * The rules live here — free of env, DB and network access — so the send order
 * and the "who still has room" decision can be unit-tested directly.
 */

/**
 * Providers in the order they are tried. Mailgun first, always. When the
 * next provider arrives it goes in place of `resend` (the user will decide
 * whether Resend stays as a final overflow behind it).
 */
export const EMAIL_PROVIDER_ORDER: EmailProviderName[] = [
  "mailgun",
  "mailtop",
  "resend",
];

export interface ProviderCapacity {
  name: EmailProviderName;
  /** False when the provider has no API key configured. */
  configured: boolean;
  used: number;
  limit: number;
  remaining: number;
  /**
   * True when the provider itself said "no allowance left" today, whatever the
   * stored count says. A provider's real allowance can be lower than the
   * configured limit (Mailtrap refused at 133 when env said 150), so this flag —
   * not the arithmetic — decides whether the provider may be offered again.
   */
  exhausted?: boolean;
  /** When the provider first refused today (UTC ISO). */
  exhaustedAt?: string | null;
  /**
   * What the provider actually said when it refused. Without this the panel can
   * only print "limit reached" next to a counter that looks half empty, which
   * reads as a bug rather than as information.
   */
  exhaustedReason?: string | null;
}

/** Human label used in logs, API payloads and the settings page. */
export const EMAIL_PROVIDER_LABELS: Record<EmailProviderName, string> = {
  mailgun: "Mailgun",
  mailtop: "Mailtop (Mailtrap)",
  resend: "Resend",
};

/**
 * The send order for one email: every configured provider that still has room
 * today, in the fixed order above. Each free tier must be spent before the
 * next one is touched — that is the whole point of the chain.
 */
export function buildSendPlan(capacities: ProviderCapacity[]): EmailProviderName[] {
  const byName = new Map(capacities.map((c) => [c.name, c]));

  return EMAIL_PROVIDER_ORDER.filter((name) => {
    const capacity = byName.get(name);
    return (
      Boolean(capacity?.configured) &&
      // A provider that already refused today is skipped even when the stored
      // count still looks low: its real allowance can be smaller than the number
      // in env, and retrying it costs a PDF render and a FAILED record each time.
      !capacity?.exhausted &&
      (capacity?.remaining ?? 0) > 0
    );
  });
}

/** Total emails still available today across every configured provider. */
export function totalRemaining(capacities: ProviderCapacity[]): number {
  return capacities
    .filter((c) => c.configured)
    .reduce((sum, c) => sum + (c.exhausted ? 0 : Math.max(0, c.remaining)), 0);
}

/** "Mailgun 100/100, Mailtop 0/150, Resend 50/50" — used in the exhausted-everything error. */
export function describeCapacity(capacities: ProviderCapacity[]): string {
  return capacities
    .filter((c) => c.configured)
    .map((c) => `${EMAIL_PROVIDER_LABELS[c.name]} ${c.used}/${c.limit}`)
    .join(", ");
}

/**
 * Splits `"NextCall <hello@getnextcall.com>"` into its parts.
 *
 * Mailgun accepts the raw `"Name <address>"` string in its `from` field while
 * Mailtrap (Mailtrap.io) wants `{ email, name }` as two fields, so the sender
 * env var can stay in either form.
 */
export function parseFromAddress(raw: string): { email: string; name?: string } {
  const trimmed = raw.trim();
  const angled = trimmed.match(/^(.*?)<([^>]+)>$/);

  if (angled) {
    const name = angled[1].trim().replace(/^"|"$/g, "").trim();
    const email = angled[2].trim();
    return name ? { email, name } : { email };
  }

  return { email: trimmed };
}
