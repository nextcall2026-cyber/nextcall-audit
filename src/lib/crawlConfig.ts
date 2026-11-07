import "server-only";

/**
 * Crawl budget and which pages deserve it.
 *
 * The crawler has a hard wall-clock deadline in the audit worker, so it cannot
 * read a whole site. What it can do is pick the RIGHT pages — and the old
 * rules picked badly: the path patterns were anchored to the exact end of the
 * path, so "/commercial-services" (a hyphen, not a slash, before "services")
 * and "/raleigh-kitchen-remodel-contractor" both scored 0. On a 21-link site
 * only 2 links were eligible, which wasted the whole budget.
 */
export const CRAWL_LIMITS = {
  /**
   * Homepage + 6. About and contact used to fill most of a 5-page budget while
   * every services page was dropped; the extra room is what lets the site's
   * own footer index (which lists those services) actually be used.
   */
  maxPages: 7,
  maxDepth: 1, // 1 means we only crawl links found on the homepage
  timeoutMs: 10000,
  maxResponseBytes: 2 * 1024 * 1024, // 2MB
  /** Secondary pages fetched in parallel; the homepage always goes first (it
   *  seeds the queue). Two at a time is gentle on small business sites. */
  parallelPages: 2,
  /** Hard wall-clock cap for the whole crawl: the audit worker's time window
   *  is tight, and one slow website must not eat it. */
  overallTimeoutMs: 20_000,
};

/**
 * Pages we never want to spend budget on: legal boilerplate, CMS internals,
 * feeds and anything that is not a real content page.
 */
const PATH_EXCLUSIONS =
  /privacy|terms|cookie|legal|disclaimer|sitemap|\/wp-|wp-content|\/feed|\/tag\/|\/category\/|\/author\/|\/page\/\d|login|signin|sign-in|signup|register|cart|checkout|my-account|admin|\/search|\.(pdf|jpe?g|png|gif|svg|xml|zip|css|js)$/i;

/**
 * Path keywords, matched ANYWHERE in the path rather than only at its end.
 * Order matters: the first match wins, so the highest-value page types sit on
 * top.
 */
const PATH_KEYWORDS: { test: RegExp; score: number }[] = [
  { test: /contact|get-in-touch|reach-us|request-a-quote|free-quote/i, score: 100 },
  { test: /about|our-story|who-we-are|our-team|meet-the|our-company/i, score: 80 },
  { test: /book|booking|schedule|appointment/i, score: 70 },
  { test: /service|what-we-do|our-work|solution|capabilit/i, score: 65 },
  { test: /pricing|price|estimate|quote|rate|cost/i, score: 55 },
  { test: /gallery|portfolio|project|photo|gallery/i, score: 50 },
  { test: /review|testimonial|case-stud/i, score: 45 },
  { test: /area|location|cities|service-area/i, score: 45 },
  { test: /faq|question/i, score: 40 },
];

/**
 * Anchor-text keywords. A link's own label is often the only clue: a small
 * business names its pages by what it does ("Raleigh Kitchen Remodel") rather
 * than by the page type, so the URL alone scores nothing.
 */
const TEXT_KEYWORDS: { test: RegExp; score: number }[] = [
  { test: /contact|get in touch|reach us|free quote|request a quote/i, score: 100 },
  { test: /about|our story|who we are|our team|meet the/i, score: 80 },
  { test: /book|schedule|appointment/i, score: 70 },
  { test: /service|what we do|solution/i, score: 65 },
  {
    // Trades and local service types — this is the "what does this business
    // actually do" signal, and it is what makes an audit sound like it was
    // written for one business instead of a template.
    test: /remodel|renovat|repair|install|clean|construct|build|plumb|electric|roof|hvac|heat|air|paint|landscap|lawn|handyman|haul|moving|pest|garage|door|window|floor|carpet|fence|concret|mason|salon|spa|barber|massage|dentist|dental|chiro|clinic|medical|law|attorney|account|tax|insurance|real estate|auto|tire|detailing|photograph|catering|bakery|restaurant/i,
    score: 60,
  },
  { test: /pricing|price|estimate|rate|cost/i, score: 55 },
  { test: /gallery|portfolio|project|our work|photo/i, score: 50 },
  { test: /review|testimonial/i, score: 45 },
  { test: /area|location/i, score: 45 },
  { test: /faq|question/i, score: 40 },
];

/**
 * How badly a candidate page is wanted.
 *
 * Returns 0 or less when the link should be skipped entirely (boilerplate,
 * assets, off-site). The caller only queues pages scoring above 0.
 */
export function scoreCandidatePage(url: string, anchorText = ""): number {
  let path = "";
  try {
    path = new URL(url).pathname;
  } catch {
    return -1; // Invalid URL
  }

  if (PATH_EXCLUSIONS.test(path)) return 0;

  const forPath = PATH_KEYWORDS.find((entry) => entry.test.test(path));
  const forText = TEXT_KEYWORDS.find((entry) => entry.test.test(anchorText));

  // A link can earn its place on either signal; the better one wins so an
  // unremarkable path with a telling label is not thrown away.
  return Math.max(forPath?.score ?? 0, forText?.score ?? 0);
}

/**
 * Kept for the existing callers: scoring by URL alone.
 */
export function getUrlScore(url: string): number {
  return scoreCandidatePage(url);
}
