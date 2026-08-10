import "server-only";

const TRACKING_PARAMS = [
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 
  'fbclid', 'gclid', 'ref', 'ref_src', 'mc_cid', 'mc_eid'
];

/**
 * Normalizes a URL to prevent duplicate crawling.
 * - Removes tracking parameters
 * - Removes fragments (#)
 * - Normalizes trailing slashes (removes them, unless root)
 * - Forces HTTPS if protocol-relative (//) is used
 */
export function normalizeUrl(rawUrl: string, baseUrl?: string): string | null {
  try {
    // Handle protocol-relative URLs
    let formattedUrl = rawUrl;
    if (rawUrl.startsWith('//')) {
      formattedUrl = `https:${rawUrl}`;
    }

    // Handle relative URLs
    if (baseUrl) {
      formattedUrl = new URL(formattedUrl, baseUrl).toString();
    }

    const url = new URL(formattedUrl);

    // Force HTTPS for normalization consistency
    if (url.protocol === 'http:') {
      url.protocol = 'https:';
    }

    // Remove tracking parameters
    TRACKING_PARAMS.forEach(param => url.searchParams.delete(param));

    // Remove fragment
    url.hash = '';

    // Normalize path (remove trailing slash, unless it's the root '/')
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) {
      url.pathname = path.slice(0, -1);
    }

    // Return clean URL string
    return url.toString();
  } catch (error) {
    // Invalid URL
    return null;
  }
}
