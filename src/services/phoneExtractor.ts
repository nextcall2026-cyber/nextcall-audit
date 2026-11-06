import "server-only";
import * as cheerio from "cheerio";
import { PhoneData } from "@/types";

export class PhoneExtractor {
  extract(html: string, sourceUrl: string): PhoneData[] {
    const $ = cheerio.load(html);
    const foundPhones = new Map<string, PhoneData>();

    $('script[type="application/ld+json"]').each((_, element) => {
      try {
        const jsonData = JSON.parse($(element).html() || '{}');
        const phonesToCheck = [jsonData.telephone, jsonData.contactPoint?.telephone, jsonData.mainEntity?.telephone];
        for (const p of phonesToCheck) {
          if (typeof p === 'string') {
            const normalized = this.normalize(p);
            if (normalized && !foundPhones.has(normalized)) {
              foundPhones.set(normalized, {
                number: p.trim(),
                normalized,
                sourceUrl,
                sourceType: "JSON_LD",
                confidence: 100
              });
            }
          }
        }
      } catch {}
    });

    $('a[href^="tel:"]').each((_, element) => {
      const href = $(element).attr('href') || '';
      const phone = href.replace('tel:', '').split('?')[0].trim();
      const normalized = this.normalize(phone);
      if (normalized && !foundPhones.has(normalized)) {
        foundPhones.set(normalized, {
          number: phone,
          normalized,
          sourceUrl,
          sourceType: "TEL_LINK",
          confidence: 95
        });
      }
    });

    // Only human-visible text.
    //
    // $('body').text() also returns the contents of inline <script> JSON blobs
    // and of <noscript> markup. That is how an image filename
    // ("david-price-logo-e1647273094202.png") and a WordPress version hash
    // became "phone numbers" and were handed to the audit as public phones.
    $('script, style, noscript, svg, template').remove();

    // The digit-run boundaries matter as much as the sanitising: without them
    // the regex happily took 12 digits out of the middle of a 13-digit number.
    const phoneRegex =
      /(?<!\d)(?:\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/g;
    const text = $('body').text() || '';
    const matches = text.match(phoneRegex) || [];

    matches.forEach(phone => {
      const normalized = this.normalize(phone);
      const digitCount = normalized.replace(/\D/g, '').length;
      if (normalized && !foundPhones.has(normalized) && digitCount >= 10 && digitCount <= 15) {
        foundPhones.set(normalized, {
          number: phone.trim(),
          normalized,
          sourceUrl,
          sourceType: "VISIBLE_TEXT",
          confidence: 70
        });
      }
    });

    return Array.from(foundPhones.values());
  }

  private normalize(phone: string): string {
    let digits = phone.replace(/\D/g, '');
    if (digits.length === 10) {
      digits = `1${digits}`;
    }
    if (digits.length === 11 && digits.startsWith('1')) {
      return `+${digits}`;
    }
    if (digits.length > 11 && digits.length <= 15) {
      return `+${digits}`;
    }
    return '';
  }
}

export const phoneExtractor = new PhoneExtractor();
