/**
 * Business-notes parser.
 *
 * Turns free-text notes a user provides about a business (e.g. "Instagram:
 * instagram.com/jlplumbing, books through Calendly, info@jlplumbing.com")
 * into structured audit signals: social profiles, booking, email, phone,
 * website. Deterministic (no LLM), so behavior is predictable and testable.
 *
 * The parsed values are MERGED with the enrichment crawl BEFORE the audit
 * runs, so an audit can score social presence / booking / email that the
 * crawl missed but the user verified manually.
 */

import { BookingData, EmailData, EnrichmentData, SocialProfile } from "@/types";

const URL_RE = /(?:https?:\/\/)?(?:www\.)?([a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+)(\/[^\s]*)?/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;

type Platform = SocialProfile["platform"];

const SOCIAL_HOSTS: Record<string, Platform> = {
  "facebook.com": "facebook",
  "fb.com": "facebook",
  "instagram.com": "instagram",
  "instagr.am": "instagram",
  "linkedin.com": "linkedin",
  "tiktok.com": "tiktok",
  "youtube.com": "youtube",
  "youtu.be": "youtube",
  "twitter.com": "twitter",
  "x.com": "twitter",
  "wa.me": "other",
};

const BOOKING_HOSTS: Record<string, string> = {
  "calendly.com": "Calendly",
  "booksy.com": "Booksy",
  "setmore.com": "Setmore",
  "acuityscheduling.com": "Acuity Scheduling",
  "squareup.com": "Square",
  "square.site": "Square",
  "mindbodyonline.com": "Mindbody",
  "vagaro.com": "Vagaro",
  "scheduleonce.com": "ScheduleOnce",
  "appointlet.com": "Appointlet",
  "appointlet.io": "Appointlet",
  "zoho.com": "Zoho Booking",
};

const BOOKING_KEYWORD_RE =
  /\b(?:online\s+)?(?:book|booking|appoint|schedule|reservation)s?|book\s+an\s+appointment\b/gi;

const NO_BOOKING_RE =
  /\b(?:no|without|doesn'?t|does\s+not|don'?t|not)\b[^.\n]{0,60}\b(?:online\s+)?booking\b/gi;

// Keyword-only social detection: users often write "they have a Facebook page"
// or "Instagram: @jlplumbing" without a URL. These produce low-confidence
// profiles (no URL) so the audit can still credit the platform.
const SOCIAL_KEYWORDS: Record<string, Platform> = {
  facebook: "facebook",
  instagram: "instagram",
  insta: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube",
  twitter: "twitter",
};

const SOCIAL_KEYWORD_RE =
  /\b(facebook|instagram|insta|linkedin|tiktok|youtube|twitter)\b/gi;

// "they don't have facebook" should not credit a profile
const NO_SOCIAL_RE =
  /\b(?:no|without|doesn'?t|does\s+not|don'?t|not)\b[^.\n]{0,40}\b(?:facebook|instagram|insta|linkedin|tiktok|youtube|twitter)\b/gi;

// "separate contact us section", "they have a contact form", "contact page"
// — the owner verified a reachable contact channel on the website.
// No /g flag: test() on a global regex keeps lastIndex state between calls.
const CONTACT_FORM_RE = /\bcontact\s+(?:form|us|page|section)\b/i;

// A pasted website audit usually states the postal address on a labelled line:
// "Address: 123 Main St, Columbia, SC 29201". Both the labelled line and a
// strict US street/city/state/ZIP pattern are tried, in that order.
const LABELED_ADDRESS_RE =
  /(?:^|\n)\s*(?:business\s+|company\s+|office\s+|postal\s+)?(?:address|location|headquarters|hq)\s*[:\-–]\s*([^\n]{5,200})/i;
const US_FULL_ADDRESS_RE =
  /\b(\d{1,6}[A-Za-z0-9 .'#-]{0,60}?),\s*([A-Za-z .'-]{2,40}?),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/;
const CITY_STATE_ZIP_RE = /\b([A-Z][A-Za-z .'-]{1,30}),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)\b/;
const EMPTY_ADDRESS_RE =
  /^(?:n\/?a|none|null|unknown|not\s+(?:listed|available|provided|found|stated)|no\s+address|[-–]+)$/i;

export interface ParsedLocation {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface ParsedNotes {
  socialProfiles: SocialProfile[];
  booking: BookingData | null;
  emails: EmailData[];
  phone: string | null;
  website: string | null;
  mentionsContactForm: boolean;
  /** Postal address stated in the notes, when one can be read reliably. */
  location: ParsedLocation | null;
}

function normalizeUrl(raw: string): string {
  // Drop trailing punctuation that may follow a URL in free text
  // (e.g. "visit jlplumbing.com," or "(https://facebook.com/jlplumbing).")
  const trimmed = raw
    .trim()
    .replace(/^\/+/, "")
    .replace(/[.,;:!?)\]"'`]+$/, "")
    .replace(/^\/+/, "");
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
}

function hostOf(normalized: string): string {
  try {
    const u = new URL(normalized);
    return u.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return normalized.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  }
}

/**
 * Reads a postal address out of free text. Deliberately conservative: a
 * labelled line or a complete US street/city/state/ZIP run only, so a pasted
 * audit cannot fill the record with half a sentence.
 */
function parseLocation(notes: string): ParsedLocation | null {
  const labelled = LABELED_ADDRESS_RE.exec(notes)?.[1]?.trim() ?? null;
  const source = labelled ?? notes;

  const full = US_FULL_ADDRESS_RE.exec(source);
  if (full) {
    const address = full[1].trim().replace(/\s+/g, " ");
    if (address.length >= 5) {
      return {
        address,
        city: full[2].trim(),
        state: full[3].toUpperCase(),
        zip: full[4],
      };
    }
  }

  const cityStateZip = CITY_STATE_ZIP_RE.exec(source);
  if (cityStateZip) {
    return {
      city: cityStateZip[1].trim(),
      state: cityStateZip[2].toUpperCase(),
      zip: cityStateZip[3],
    };
  }

  // A labelled line without a recognisable structure: keep it only when it is
  // long enough to be an address and short enough not to be prose.
  if (labelled && labelled.length >= 8 && labelled.length <= 160 && !EMPTY_ADDRESS_RE.test(labelled)) {
    if (!/https?:\/\/|@/.test(labelled)) {
      return { address: labelled.replace(/\s+/g, " ") };
    }
  }

  return null;
}

export function parseBusinessNotes(notes: string): ParsedNotes {
  const socialProfiles: SocialProfile[] = [];
  const bookingUrls: string[] = [];
  const genericUrls: string[] = [];

  const noBooking = NO_BOOKING_RE.test(notes);

  let match: RegExpExecArray | null;
  URL_RE.lastIndex = 0;
  while ((match = URL_RE.exec(notes)) !== null) {
    const host = hostOf(match[1]);
    const socialPlatform = SOCIAL_HOSTS[host];
    if (socialPlatform) {
      const url = normalizeUrl(match[0]);
      if (!socialProfiles.some((s) => s.url === url)) {
        socialProfiles.push({
          platform: socialPlatform,
          url,
          sourceUrl: "user provided",
          confidence: 100,
        });
      }
      continue;
    }
    if (!noBooking && BOOKING_HOSTS[host]) {
      bookingUrls.push(normalizeUrl(match[0]));
      continue;
    }
    genericUrls.push(normalizeUrl(match[0]));
  }

  // Booking by keyword: e.g. "they take bookings at jlplumbing.com/appointments"
  if (!noBooking && bookingUrls.length === 0) {
    BOOKING_KEYWORD_RE.lastIndex = 0;
    const kw = BOOKING_KEYWORD_RE.exec(notes.toLowerCase());
    if (kw && genericUrls.length > 0) {
      const url = genericUrls[0];
      const hasBookingPath = /\/?(book|appoint|schedule|reserve)/.test(url);
      if (hasBookingPath) {
        bookingUrls.push(url);
      }
    }
  }

  // Booking by keyword alone: e.g. "they have a book online button on the
  // website" (no URL in the notes). Credit a generic online booking signal.
  BOOKING_KEYWORD_RE.lastIndex = 0;
  const hasBookingKeyword = BOOKING_KEYWORD_RE.test(notes.toLowerCase());
  if (!noBooking && bookingUrls.length === 0 && hasBookingKeyword) {
    bookingUrls.push(""); // sentinel handled below
  }

  // Keyword-only social profiles: "they have a Facebook page and Instagram"
  const negated = new Set<string>();
  NO_SOCIAL_RE.lastIndex = 0;
  while ((match = NO_SOCIAL_RE.exec(notes.toLowerCase())) !== null) {
    for (const keyword of Object.keys(SOCIAL_KEYWORDS)) {
      if (match[0].includes(keyword)) negated.add(keyword);
    }
  }

  SOCIAL_KEYWORD_RE.lastIndex = 0;
  const seenPlatforms = new Set(socialProfiles.map((s) => s.platform));
  while ((match = SOCIAL_KEYWORD_RE.exec(notes.toLowerCase())) !== null) {
    const keyword = match[1].toLowerCase();
    const platform = SOCIAL_KEYWORDS[keyword];
    if (!platform || seenPlatforms.has(platform) || negated.has(keyword)) continue;
    seenPlatforms.add(platform);
    socialProfiles.push({
      platform,
      url: "",
      sourceUrl: "user provided",
      confidence: 60,
    });
  }

  const bookingUrl = bookingUrls.length > 0 ? bookingUrls[0] : null;
  const booking: BookingData | null =
    bookingUrl !== null
      ? {
          detected: true,
          systemName: bookingUrl === "" ? "online booking" : (BOOKING_HOSTS[hostOf(bookingUrl)] ?? "online booking"),
          url: bookingUrl === "" ? undefined : bookingUrl,
          sourceUrl: "user provided",
          confidence: bookingUrl === "" ? 70 : 90,
        }
      : null;

  // Emails (dedupe)
  const emails: EmailData[] = [];
  EMAIL_RE.lastIndex = 0;
  while ((match = EMAIL_RE.exec(notes)) !== null) {
    const address = match[0].toLowerCase();
    if (!emails.some((e) => e.address === address)) {
      emails.push({
        address,
        type: "BUSINESS",
        sourceUrl: "user provided",
        sourceType: "VISIBLE_TEXT",
        confidence: 100,
      });
    }
  }

  // Phone (first match)
  let phone: string | null = null;
  PHONE_RE.lastIndex = 0;
  const phoneMatch = PHONE_RE.exec(notes);
  if (phoneMatch && !socialProfiles.some((s) => s.url.includes(phoneMatch[0].replace(/[^\d]/g, "")))) {
    phone = phoneMatch[0].trim();
  }

  // Generic website = first URL that is not social, booking or email
  const website: string | null = genericUrls[0] ?? null;

  return {
    socialProfiles,
    booking,
    emails,
    phone,
    website,
    mentionsContactForm: CONTACT_FORM_RE.test(notes),
    location: parseLocation(notes),
  };
}

/**
 * Merges user-verified signals from free-text notes into an enrichment
 * result, so anything the user confirmed manually (socials, booking, email,
 * phone, contact section) is scored by the audit even if the website crawl
 * missed it. Crawl findings are NEVER overwritten — notes only fill gaps
 * and upgrade "not found" / "unknown" to "user verified".
 */
export function mergeNotesIntoEnrichment(
  enrichment: EnrichmentData,
  parsed: ParsedNotes
): EnrichmentData {
  const merged: EnrichmentData = { ...enrichment };

  if (parsed.socialProfiles.length > 0) {
    const existing = enrichment.socialProfiles || [];
    const seenUrls = new Set(existing.map((s) => s.url));
    const seenKeywordPlatforms = new Set(
      existing.filter((s) => !s.url).map((s) => s.platform)
    );
    const added = parsed.socialProfiles.filter(
      (s) => !seenUrls.has(s.url) && !(s.url === "" && seenKeywordPlatforms.has(s.platform))
    );
    if (added.length > 0) {
      merged.socialProfiles = [...existing, ...added];
    }
  }

  if (parsed.emails.length > 0) {
    const existing = enrichment.emails || [];
    const seen = new Set(existing.map((e) => e.address));
    const added = parsed.emails.filter((e) => !seen.has(e.address));
    if (added.length > 0) {
      merged.emails = [...existing, ...added];
    }
    merged.preferredEmail = merged.preferredEmail || parsed.emails[0].address;
  }

  if (parsed.booking && !enrichment.booking?.detected) {
    merged.booking = parsed.booking;
  }

  if (parsed.phone && !(enrichment.phones && enrichment.phones.length > 0)) {
    merged.phones = [
      {
        number: parsed.phone,
        normalized: parsed.phone,
        sourceUrl: "user provided",
        sourceType: "VISIBLE_TEXT",
        confidence: 90,
      },
    ];
  }

  // "contact form" / "contact us section" in the notes: the owner verified a
  // reachable contact channel, so upgrade a missing/unknown form signal.
  if (parsed.mentionsContactForm && enrichment.features?.hasContactForm !== true) {
    merged.features = {
      hasContactForm: true,
      hasLiveChat: enrichment.features?.hasLiveChat ?? "UNKNOWN",
      hasClickToCall: enrichment.features?.hasClickToCall ?? "UNKNOWN",
      hasSecureSSL: enrichment.features?.hasSecureSSL ?? "UNKNOWN",
    };
  }

  return merged;
}