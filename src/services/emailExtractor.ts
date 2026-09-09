import "server-only";
import * as cheerio from "cheerio";
import { EmailData } from "@/types";

const PLACEHOLDER_EMAILS = [
  'example@example.com', 'test@test.com', 'user@example.com',
  'your@email.com', 'name@domain.com', 'email@domain.com'
];

const BUSINESS_PREFIXES = ['info', 'contact', 'hello', 'office', 'sales', 'support', 'admin', 'team'];

export class EmailExtractor {
  extract(html: string, sourceUrl: string): EmailData[] {
    const $ = cheerio.load(html);
    const foundEmails = new Map<string, EmailData>();

    $('a[href^="mailto:"]').each((_, element) => {
      const href = $(element).attr('href') || '';
      const email = href.replace('mailto:', '').split('?')[0].trim().toLowerCase();
      if (email && !PLACEHOLDER_EMAILS.includes(email)) {
        foundEmails.set(email, {
          address: email,
          type: this.classifyEmail(email),
          sourceUrl,
          sourceType: "MAILTO",
          confidence: 95
        });
      }
    });

    $('script[type="application/ld+json"]').each((_, element) => {
      try {
        const jsonData = JSON.parse($(element).html() || '{}');
        const emailsToCheck = [jsonData.email, jsonData.mainEntity?.email, jsonData.contactPoint?.email];
        for (const e of emailsToCheck) {
          if (typeof e === 'string') {
            const email = e.trim().toLowerCase();
            if (email.includes('@') && !PLACEHOLDER_EMAILS.includes(email) && !foundEmails.has(email)) {
              foundEmails.set(email, {
                address: email,
                type: this.classifyEmail(email),
                sourceUrl,
                sourceType: "JSON_LD",
                confidence: 100
              });
            }
          }
        }
      } catch {
        // Invalid JSON, skip
      }
    });

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const text = $('body').text() || '';
    const matches = text.match(emailRegex) || [];
    matches.forEach(email => {
      const normalized = email.trim().toLowerCase();
      if (!PLACEHOLDER_EMAILS.includes(normalized) && !foundEmails.has(normalized)) {
        foundEmails.set(normalized, {
          address: normalized,
          type: this.classifyEmail(normalized),
          sourceUrl,
          sourceType: "VISIBLE_TEXT",
          confidence: 80
        });
      }
    });

    const obfuscatedRegex = /([a-zA-Z0-9._%+-]+)\s*(?:\[at\]|\(at\)|\s*at\s*)\s*([a-zA-Z0-9.-]+)\s*(?:\[dot\]|\(dot\)|\s*dot\s*)\s*([a-zA-Z]{2,})/gi;
    let obfMatch;
    while ((obfMatch = obfuscatedRegex.exec(text)) !== null) {
      const email = `${obfMatch[1]}@${obfMatch[2]}.${obfMatch[3]}`.trim().toLowerCase();
      if (!PLACEHOLDER_EMAILS.includes(email) && !foundEmails.has(email)) {
        foundEmails.set(email, {
          address: email,
          type: this.classifyEmail(email),
          sourceUrl,
          sourceType: "OBFUSCATED",
          confidence: 70
        });
      }
    }

    return Array.from(foundEmails.values());
  }

  private classifyEmail(email: string): EmailData['type'] {
    const prefix = email.split('@')[0];
    if (BUSINESS_PREFIXES.includes(prefix)) {
      return "BUSINESS";
    }
    if (/^[a-z]+\.[a-z]+$/.test(prefix) || /^[a-z]{1,2}[a-z]+$/.test(prefix)) {
      return "PERSONAL";
    }
    return "UNKNOWN";
  }
}

export const emailExtractor = new EmailExtractor();
