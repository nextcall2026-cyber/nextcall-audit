import "server-only";
import * as cheerio from "cheerio";
import { BookingData } from "@/types";
import { normalizeUrl } from "@/lib/urlNormalizer";

const BOOKING_SYSTEMS: { name: string; domains: string[] }[] = [
  { name: 'Calendly', domains: ['calendly.com'] },
  { name: 'Square Appointments', domains: ['square.site', 'squareup.com'] },
  { name: 'Fresha', domains: ['fresha.com'] },
  { name: 'Vagaro', domains: ['vagaro.com'] },
  { name: 'Mindbody', domains: ['mindbodyonline.com', 'mindbody.site'] },
  { name: 'Setmore', domains: ['setmore.com'] },
  { name: 'Acuity Scheduling', domains: ['acuityscheduling.com'] },
  { name: 'Booksy', domains: ['booksy.com'] },
  { name: 'SimplyBook.me', domains: ['simplybook.me'] },
];

const GENERIC_BOOKING_PATHS = ['/book', '/booking', '/book-now', '/appointments', '/appointment', '/schedule', '/scheduling'];

export function extractBookingData(html: string, sourceUrl: string): BookingData {
  const $ = cheerio.load(html);
  let bookingData: BookingData = { detected: false };

  const checkUrl = (urlStr: string): void => {
    if (bookingData.detected) return;
    if (!urlStr || !urlStr.startsWith('http')) return;

    try {
      const rawUrl = new URL(urlStr);
      const hostname = rawUrl.hostname.toLowerCase();
      const path = rawUrl.pathname.toLowerCase();

      for (const system of BOOKING_SYSTEMS) {
        const isMatch = system.domains.some(domain =>
          hostname === domain || hostname.endsWith(`.${domain}`)
        );

        if (isMatch) {
          const cleanUrl = normalizeUrl(urlStr) || urlStr;
          bookingData = {
            detected: true,
            systemName: system.name,
            url: cleanUrl,
            sourceUrl,
            confidence: 95
          };
          return;
        }
      }

      const businessDomain = new URL(sourceUrl).hostname.replace(/^www\./, '');
      if (hostname.includes(businessDomain)) {
        if (GENERIC_BOOKING_PATHS.some(p => path === p || path.startsWith(p + '/'))) {
          const cleanUrl = normalizeUrl(urlStr) || urlStr;
          bookingData = {
            detected: true,
            systemName: 'Custom/Unknown',
            url: cleanUrl,
            sourceUrl,
            confidence: 75
          };
          return;
        }
      }
    } catch {
      // Invalid URL, ignore
    }
  };

  $('a[href]').each((_, el) => checkUrl($(el).attr('href') || ''));
  $('iframe[src]').each((_, el) => checkUrl($(el).attr('src') || ''));
  $('script[src]').each((_, el) => checkUrl($(el).attr('src') || ''));

  return bookingData;
}
