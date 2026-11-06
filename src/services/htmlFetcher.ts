import "server-only";
import { validateUrlForCrawling } from "@/lib/urlValidator";
import { logger } from "@/lib/logger";

import { getErrorMessage } from "@/lib/errors";
export interface FetchResult {
  success: boolean;
  html?: string;
  finalUrl?: string;
  requiresJsRendering?: boolean;
  error?: string;
}

const MAX_HTML_SIZE = 2 * 1024 * 1024; // 2MB limit
const FETCH_TIMEOUT = 10000; // 10 seconds
const MAX_REDIRECTS = 5; // Safe limit to prevent infinite loops

export async function fetchHtml(initialUrl: string): Promise<FetchResult> {
  let currentUrl = initialUrl;
  let redirectCount = 0;

  try {
    while (redirectCount <= MAX_REDIRECTS) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

      const response = await fetch(currentUrl, {
        redirect: 'manual', // Handle redirects manually for SSRF safety
        signal: controller.signal,
        headers: {
          'User-Agent': 'NextCallProspectorBot/1.0 (+https://nextcall.prospector)',
          'Accept': 'text/html,application/xhtml+xml',
        },
      });

      clearTimeout(timeoutId);

      // 1. Check for Redirects (3xx)
      if (response.status >= 300 && response.status < 400) {
        const locationHeader = response.headers.get('location');
        if (!locationHeader) {
          return { success: false, error: 'Redirect response missing Location header.' };
        }

        // Resolve relative redirects (e.g., Location: /new-path)
        const nextUrl = new URL(locationHeader, currentUrl).toString();

        // SSRF PROTECTION: Validate the redirect destination!
        const validation = await validateUrlForCrawling(nextUrl);
        if (!validation.isValid || !validation.normalizedUrl) {
          logger.warn(`[HtmlFetcher] Blocked redirect to unsafe URL: ${nextUrl} (${validation.error})`);
          return { success: false, error: `SSRF Protection: Blocked redirect to unsafe URL.` };
        }

        // Follow the destination EXACTLY as the server sent it.
        //
        // validateUrlForCrawling() exists to answer "is this host safe?" and it
        // normalises by stripping "www.". Using its normalisedUrl here turned
        // every canonicalising site into an infinite loop: the bare domain
        // 301s to www, the validator stripped www again, we re-fetched the bare
        // domain, and the crawl died with "Exceeded maximum redirects". A large
        // share of small-business sites are configured exactly that way, and a
        // failed crawl makes the audit claim the website is unreachable.
        currentUrl = new URL(nextUrl).toString();
        redirectCount++;
        continue; // Loop back and fetch the new URL
      }

      // 2. Handle Non-OK responses (4xx, 5xx)
      if (!response.ok) {
        return { success: false, error: `HTTP Error: ${response.status}` };
      }

      // 3. Validate Content Type
      const contentType = response.headers.get('content-type') || '';
      if (!contentType.includes('text/html') && !contentType.includes('application/xhtml+xml')) {
        return { success: false, error: `Invalid content type: ${contentType}` };
      }

      // 4. Validate Size
      const contentLength = parseInt(response.headers.get('content-length') || '0', 10);
      if (contentLength > MAX_HTML_SIZE) {
        return { success: false, error: 'Content exceeds maximum size limit (2MB).' };
      }

      const html = await response.text();
      if (html.length > MAX_HTML_SIZE) {
        return { success: false, error: 'HTML content exceeds maximum size limit (2MB).' };
      }

      // 5. JS Rendering Heuristic
      const textContent = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<[^>]+>/g, '').trim();
      const requiresJsRendering = textContent.length < 50 && html.includes('<div id="root">');

      return { 
        success: true, 
        html, 
        // response.url is empty for a manually-followed redirect chain, so the
        // last URL we actually requested is the real address of this page.
        finalUrl: response.url || currentUrl,
        requiresJsRendering 
      };
    }

    // Exceeded max redirects
    return { success: false, error: `Exceeded maximum redirects (${MAX_REDIRECTS}).` };

  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: 'Request timed out after 10 seconds.' };
    }
    logger.error(`[HtmlFetcher] Failed to fetch ${currentUrl}:`, getErrorMessage(error));
    return { success: false, error: getErrorMessage(error) };
  }
}