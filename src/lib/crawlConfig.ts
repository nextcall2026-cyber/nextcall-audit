import "server-only";

export const CRAWL_LIMITS = {
  maxPages: 5,
  maxDepth: 1, // 1 means we only crawl links found on the homepage
  timeoutMs: 10000,
  maxResponseBytes: 2 * 1024 * 1024, // 2MB
};

// Scoring system for URL paths to prioritize high-value pages
export const PATH_SCORING: { pattern: RegExp; score: number }[] = [
  { pattern: /\/contact(-us)?\/?$/i, score: 100 },
  { pattern: /\/about(-us)?\/?$/i, score: 80 },
  { pattern: /\/book(ing)?\/?$/i, score: 70 },
  { pattern: /\/appointments?\/?$/i, score: 70 },
  { pattern: /\/schedule\/?$/i, score: 70 },
  { pattern: /\/services?\/?$/i, score: 40 },
];

/**
 * Calculates the priority score of a URL based on its path.
 * Higher scores mean higher priority for crawling.
 */
export function getUrlScore(url: string): number {
  try {
    const path = new URL(url).pathname.toLowerCase();
    for (const entry of PATH_SCORING) {
      if (entry.pattern.test(path)) {
        return entry.score;
      }
    }
    return 0; // Default score for unclassified pages
  } catch {
    return -1; // Invalid URL
  }
}
