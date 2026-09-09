import "server-only";
import { Business, EnrichmentData, EmailData, PhoneData, SocialProfile, BookingData, WebsiteFeatures, WebsiteData } from "@/types";
import { validateUrlForCrawling } from "@/lib/urlValidator";
import { fetchHtml } from "@/services/htmlFetcher";
import { emailExtractor } from "@/services/emailExtractor";
import { phoneExtractor } from "@/services/phoneExtractor";
import { extractSocialProfiles } from "@/services/socialExtractor";
import { extractBookingData } from "@/services/bookingExtractor";
import { extractWebsiteFeatures } from "@/services/featureExtractor";
import { normalizeUrl } from "@/lib/urlNormalizer";
import { getUrlScore, CRAWL_LIMITS } from "@/lib/crawlConfig";
import { logger } from "@/lib/logger";
import * as cheerio from "cheerio";

import { getErrorMessage } from "@/lib/errors";
export class EnrichmentOrchestrator {
  async enrichBusiness(business: Business): Promise<EnrichmentData> {
    const enrichment: EnrichmentData = {
      status: "IN_PROGRESS",
      lastAttemptedAt: new Date().toISOString(),
    };

    if (!business.website) {
      enrichment.status = "FAILED";
      enrichment.error = "No website provided by discovery provider.";
      return enrichment;
    }

    try {
      // 1. Validate Initial URL (SSRF Protection)
      const validation = await validateUrlForCrawling(business.website);
      if (!validation.isValid || !validation.normalizedUrl) {
        enrichment.status = "FAILED";
        enrichment.error = validation.error || "Invalid URL.";
        return enrichment;
      }

      const startTime = Date.now();
      const targetUrl = validation.normalizedUrl;

      // 2. Crawl State Setup
      const visited = new Set<string>();
      const queue: { url: string; score: number }[] = [];

      const allEmails = new Map<string, EmailData>();
      const allPhones = new Map<string, PhoneData>();
      const allSocials = new Map<string, SocialProfile>();
      let bookingData: BookingData = { detected: false };
      const featureFlags = { hasContactForm: false, hasLiveChat: false, hasClickToCall: false, hasSecureSSL: targetUrl.startsWith('https://') };

      let pagesAttempted = 0;
      let pagesSuccessful = 0;
      let pagesFailed = 0;
      let jsRenderingLikely = false;

      // Add homepage to queue with highest priority
      queue.push({ url: targetUrl, score: 1000 });

      // 3. Process Queue
      while (queue.length > 0 && visited.size < CRAWL_LIMITS.maxPages) {
        // Sort by score descending
        queue.sort((a, b) => b.score - a.score);
        const currentItem = queue.shift();

        if (!currentItem || visited.has(currentItem.url)) continue;

        visited.add(currentItem.url);
        pagesAttempted++;

        // Fetch HTML
        const fetchResult = await fetchHtml(currentItem.url);
        if (!fetchResult.success || !fetchResult.html) {
          pagesFailed++;
          continue;
        }

        pagesSuccessful++;
        const html = fetchResult.html;
        const sourceUrl = currentItem.url;

        if (fetchResult.requiresJsRendering) {
          jsRenderingLikely = true;
        }

        // Extract Data
        const emails = emailExtractor.extract(html, sourceUrl);
        emails.forEach(e => allEmails.set(e.address, e));

        const phones = phoneExtractor.extract(html, sourceUrl);
        phones.forEach(p => allPhones.set(p.normalized, p));

        const socials = extractSocialProfiles(html, sourceUrl);
        socials.forEach(s => allSocials.set(s.platform, s));

        if (!bookingData.detected) {
          const booking = extractBookingData(html, sourceUrl);
          if (booking.detected) bookingData = booking;
        }

        const features = extractWebsiteFeatures(html, sourceUrl);
        if (features.hasContactForm) featureFlags.hasContactForm = true;
        if (features.hasLiveChat) featureFlags.hasLiveChat = true;
        if (features.hasClickToCall) featureFlags.hasClickToCall = true;

        // Discover new links only from the Homepage (depth 1)
        if (visited.size === 1) {
          const $ = cheerio.load(html);
          $('a[href]').each((_, element) => {
            const rawHref = $(element).attr('href') || '';
            const cleanUrl = normalizeUrl(rawHref, sourceUrl);

            if (cleanUrl && !visited.has(cleanUrl)) {
              // Ensure it's the same domain
              try {
                const targetDomain = new URL(targetUrl).hostname;
                const linkDomain = new URL(cleanUrl).hostname;
                if (targetDomain === linkDomain) {
                  const score = getUrlScore(cleanUrl);
                  if (score > 0) { // Only queue high-value pages
                    queue.push({ url: cleanUrl, score });
                  }
                }
              } catch {}
            }
          });
        }
      }

      // 4. Aggregate & Finalize Data
      const crawlDurationMs = Date.now() - startTime;
      const crawlQuality = jsRenderingLikely ? "JS_RENDERING_LIKELY" : (pagesSuccessful > 0 ? "STATIC_COMPLETE" : "FAILED");

      // Tri-State Logic: If JS rendering is likely, we can't be sure features are missing
      const finalFeatures: WebsiteFeatures = {
        hasContactForm: jsRenderingLikely ? 'UNKNOWN' : featureFlags.hasContactForm,
        hasLiveChat: jsRenderingLikely ? 'UNKNOWN' : featureFlags.hasLiveChat,
        hasClickToCall: jsRenderingLikely ? 'UNKNOWN' : featureFlags.hasClickToCall,
        hasSecureSSL: featureFlags.hasSecureSSL, // SSL is known from the URL
      };

      const websiteData: WebsiteData = {
        url: targetUrl,
        isReachable: pagesSuccessful > 0,
        requiresJsRendering: jsRenderingLikely,
      };

      // Prioritize Emails (BUSINESS > GENERAL > PERSONAL > UNKNOWN)
      const emailArray = Array.from(allEmails.values());
      const preferredEmail = emailArray.find(e => e.type === 'BUSINESS') ||
                             emailArray.find(e => e.type === 'GENERAL') ||
                             emailArray.find(e => e.type === 'PERSONAL');

      enrichment.status = "COMPLETED";
      enrichment.completedAt = new Date().toISOString();
      enrichment.website = websiteData;
      enrichment.emails = emailArray;
      enrichment.phones = Array.from(allPhones.values());
      enrichment.socialProfiles = Array.from(allSocials.values());
      enrichment.booking = bookingData;
      enrichment.features = finalFeatures;
      enrichment.preferredEmail = preferredEmail?.address || null;

      enrichment.crawlMetadata = {
        pagesAttempted,
        pagesSuccessful,
        pagesFailed,
        pagesVisited: Array.from(visited),
        crawlQuality,
        renderingRequired: jsRenderingLikely,
        crawlDurationMs,
      };

      logger.info(`[EnrichmentOrchestrator] Successfully enriched ${business.name}. Pages: ${pagesSuccessful}/${pagesAttempted}. Emails: ${emailArray.length}.`);
      return enrichment;

    } catch (error) {
      logger.error(`[EnrichmentOrchestrator] Unexpected error enriching ${business.name}:`, getErrorMessage(error));
      enrichment.status = "FAILED";
      enrichment.error = `Unexpected pipeline error: ${getErrorMessage(error)}`;
      return enrichment;
    }
  }
}

export const enrichmentService = new EnrichmentOrchestrator();
