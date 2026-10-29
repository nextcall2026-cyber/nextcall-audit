/**
 * Picks the address that should actually receive the audit email.
 *
 * A pasted website audit usually mentions several addresses ("info@",
 * "billing@", a Gmail the owner actually reads…). The operator's rule:
 *
 *   1. an owner-looking free mailbox that carries the business name
 *      ("carolinalandscaping@gmail.com" for "Carolina Landscaping") wins —
 *      that is the inbox a small-business owner reads;
 *   2. otherwise any other address that carries the business name;
 *   3. otherwise the first plausible address in the list.
 *
 * Addresses that exist to send mail FROM (no-reply@, postmaster@…), platform
 * addresses (sentry, wixpress…) and file names that naive regexes mistake for
 * emails ("logo@2x.png") are filtered out first — emailing those bounces.
 */

import { Business } from "@/types";
import { parseBusinessNotes } from "@/services/notesParser";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

/** "logo@2x.png" and friends match a naive email regex; these are not mail. */
const ASSET_TLDS = new Set([
  "png", "jpg", "jpeg", "gif", "svg", "webp", "avif", "ico", "bmp",
  "css", "js", "json", "woff", "woff2", "ttf", "eot", "pdf", "mp4", "webm",
  "html", "htm", "php", "webm", "zip",
]);

/** Free mailboxes: a small-business owner usually reads these in person. */
const FREE_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "live.com", "live.co.uk", "msn.com", "yahoo.com", "yahoo.co.uk", "ymail.com",
  "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
  "gmx.com", "gmx.net", "gmx.de", "mail.com", "zoho.com", "web.de",
]);

/** Role addresses that receive machine mail, never a sales email. */
const ROLE_NOISE_RE =
  /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer[-_.]?daemon|postmaster|abuse|privacy|dpo|legal|unsubscribe|bounce|bounces|webmaster|hostmaster|spam|notifications?|alerts?|auto[-_.]?reply|billing|copyright|salesforce)\b/i;

/** Placeholder / platform addresses that show up in copied audits. */
const NOISE_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "domain.com", "yourdomain.com",
  "email.com", "test.com", "test.test", "sentry.io", "sentry-next.wixpress.com",
  "wixpress.com", "wordpress.com", "w3.org", "schema.org", "cloudflare.com",
  "godaddy.com", "squarespace.com", "shopify.com", "shopify.com.",
]);

const NAME_STOPWORDS = new Set([
  "llc", "inc", "ltd", "co", "corp", "corporation", "company", "the", "and",
  "of", "services", "service", "group", "enterprises", "contractors",
  "contracting", "solutions",
]);

/** True when an address can plausibly belong to the business. */
export function isPlausibleEmail(address: string | null | undefined): boolean {
  if (!address) return false;
  const value = address.trim().toLowerCase();
  if (!EMAIL_RE.test(value)) return false;

  const at = value.lastIndexOf("@");
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const tld = domain.slice(domain.lastIndexOf(".") + 1);

  if (local.length < 2) return false;
  if (ASSET_TLDS.has(tld)) return false;
  if (ROLE_NOISE_RE.test(local)) return false;
  if (NOISE_DOMAINS.has(domain)) return false;
  return true;
}

function isFreeProvider(address: string): boolean {
  return FREE_PROVIDERS.has(address.slice(address.lastIndexOf("@") + 1));
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !NAME_STOPWORDS.has(token));
}

/** Does this local part look like it belongs to the business's own name? */
export function matchesBusinessName(localPart: string, businessName: string): boolean {
  const local = compact(localPart);
  if (local.length < 4) return false;

  // Compare against the trading name only ("Deal's Plumbing LLC" -> "dealsplumbing")
  const tradingName = businessName.split(/[,|(]/)[0] ?? businessName;
  const name = compact(tradingName);
  if (name.length >= 4 && (name.includes(local) || local.includes(name))) return true;

  return nameTokens(tradingName).some((token) => local.includes(token));
}

/** Chooses the address to email from every address the audit mentions. */
export function pickBestEmail(
  addresses: Array<string | { address: string } | null | undefined>,
  businessName: string
): string | null {
  const seen = new Set<string>();
  const candidates: string[] = [];

  for (const entry of addresses) {
    const raw = typeof entry === "string" ? entry : entry?.address ?? "";
    const address = raw.trim().toLowerCase();
    if (!isPlausibleEmail(address) || seen.has(address)) continue;
    seen.add(address);
    candidates.push(address);
  }

  if (candidates.length === 0) return null;

  const ownerMailbox = candidates.find(
    (address) => isFreeProvider(address) && matchesBusinessName(address.split("@")[0], businessName)
  );
  if (ownerMailbox) return ownerMailbox;

  const namedAddress = candidates.find((address) =>
    matchesBusinessName(address.split("@")[0], businessName)
  );
  if (namedAddress) return namedAddress;

  return candidates[0];
}

/**
 * Best contact address for a stored business: an address the operator typed
 * wins outright; otherwise the stored crawl result, the business notes and any
 * pasted audit text are all searched with the priority rule above.
 */
export function pickBestEmailForBusiness(
  business: Business | null | undefined
): string | null {
  if (!business) return null;

  const storedEmails = business.enrichment?.emails ?? [];
  const preferred = business.enrichment?.preferredEmail?.trim().toLowerCase() || null;

  // A user-typed address is authoritative and must never be second-guessed.
  if (preferred) {
    const entry = storedEmails.find(
      (email) => email.address.toLowerCase() === preferred
    );
    if (entry?.sourceUrl === "user provided") return preferred;
  }

  const notesEmails = business.notes
    ? parseBusinessNotes(business.notes).emails.map((email) => email.address)
    : [];

  return pickBestEmail(
    [preferred, ...storedEmails.map((email) => email.address), ...notesEmails],
    business.name
  );
}