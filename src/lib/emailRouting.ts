import { EmailProviderName } from "@/types";

/**
 * Pure routing rules for the two-provider sending setup.
 *
 * Brevo carries the bulk of the day (its free tier allows 300 emails), Resend
 * picks up the overflow (capped at 50 here), so one day totals 350 sends. The
 * rules live here — free of env, DB and network access — so the send order and
 * the "who still has room" decision can be unit-tested directly.
 */

/** Providers in the order they are tried. Brevo first, always. */
export const EMAIL_PROVIDER_ORDER: EmailProviderName[] = ["brevo", "resend"];

export interface ProviderCapacity {
  name: EmailProviderName;
  /** False when the provider has no API key configured. */
  configured: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/** Human label used in logs, API payloads and the settings page. */
export const EMAIL_PROVIDER_LABELS: Record<EmailProviderName, string> = {
  brevo: "Brevo",
  resend: "Resend",
};

/**
 * The send order for one email: every configured provider that still has room
 * today, best (largest remaining allowance) first among equals.
 *
 * Brevo is always preferred while it has capacity, because it holds 300 of the
 * 350 daily sends; Resend only enters the plan once Brevo is spent.
 */
export function buildSendPlan(capacities: ProviderCapacity[]): EmailProviderName[] {
  const byName = new Map(capacities.map((c) => [c.name, c]));

  return EMAIL_PROVIDER_ORDER.filter((name) => {
    const capacity = byName.get(name);
    return Boolean(capacity?.configured) && (capacity?.remaining ?? 0) > 0;
  });
}

/** Total emails still available today across every configured provider. */
export function totalRemaining(capacities: ProviderCapacity[]): number {
  return capacities
    .filter((c) => c.configured)
    .reduce((sum, c) => sum + Math.max(0, c.remaining), 0);
}

/** "Brevo 300/300, Resend 50/50" — used in the exhausted-everything error. */
export function describeCapacity(capacities: ProviderCapacity[]): string {
  return capacities
    .filter((c) => c.configured)
    .map((c) => `${EMAIL_PROVIDER_LABELS[c.name]} ${c.used}/${c.limit}`)
    .join(", ");
}

/**
 * Splits `"NextCall <hello@getnextcall.com>"` into its parts.
 *
 * Brevo wants `{ email, name }` as two fields while Resend accepts the raw
 * `"Name <address>"` string, so the sender env var can stay in either form.
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
