import "server-only";
import * as cheerio from "cheerio";
import { SocialProfile } from "@/types";
import { normalizeUrl } from "@/lib/urlNormalizer";

const SOCIAL_DOMAIN_MAP: Record<string, SocialProfile["platform"]> = {
  'facebook.com': 'facebook',
  'instagram.com': 'instagram',
  'linkedin.com': 'linkedin',
  'tiktok.com': 'tiktok',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'twitter.com': 'twitter',
  'x.com': 'twitter',
};

const INVALID_PATHS = [
  '/sharer.php', '/share.php', '/intent/tweet', '/intent/user',
  '/channel/', '/watch?v=', '/results?search_query=', '/plugins/', '/share'
];

export function extractSocialProfiles(html: string, sourceUrl: string): SocialProfile[] {
  const $ = cheerio.load(html);
  const profiles = new Map<SocialProfile["platform"], SocialProfile>();

  $('a[href]').each((_, element) => {
    const rawHref = $(element).attr('href') || '';
    if (!rawHref.startsWith('http://') && !rawHref.startsWith('https://')) {
      return;
    }

    try {
      const url = new URL(rawHref);
      const hostname = url.hostname.replace(/^www\./, '').toLowerCase();

      const platform = Object.entries(SOCIAL_DOMAIN_MAP).find(
        ([domain]) => hostname === domain || hostname.endsWith(`.${domain}`)
      )?.[1];

      if (platform) {
        const isShareLink = INVALID_PATHS.some(path => url.pathname.startsWith(path));
        if (isShareLink) return;

        const cleanUrl = normalizeUrl(rawHref);
        if (!cleanUrl) return;

        const path = new URL(cleanUrl).pathname.replace(/\/$/, '');
        if (path === '' || path === '/') return;

        if (!profiles.has(platform)) {
          profiles.set(platform, {
            platform,
            url: cleanUrl,
            sourceUrl,
            confidence: 90
          });
        }
      }
    } catch {
      // Invalid URL, skip
    }
  });

  return Array.from(profiles.entries()).map(([, data]) => data);
}
