import "server-only";
import * as cheerio from "cheerio";
import { WebsiteFeatures } from "@/types";

const LIVE_CHAT_INDICATORS = [
  'intercom', 'tawk.to', 'zendesk', 'drift', 'hubspot',
  'livechat', 'crisp.chat', 'messenger'
];

export function extractWebsiteFeatures(html: string, baseUrl: string): WebsiteFeatures {
  const $ = cheerio.load(html);

  const hasSecureSSL = baseUrl.startsWith('https://');
  const hasClickToCall = $('a[href^="tel:"]').length > 0;

  let hasLiveChat = false;
  $('script[src]').each((_, element) => {
    if (hasLiveChat) return;
    const src = ($(element).attr('src') || '').toLowerCase();
    if (LIVE_CHAT_INDICATORS.some(indicator => src.includes(indicator))) {
      hasLiveChat = true;
    }
  });

  let hasContactForm = false;
  $('form').each((_, form) => {
    if (hasContactForm) return;
    const $form = $(form);
    const hasEmail = $form.find('input[type="email"], input[name*="email"]').length > 0;
    const hasText = $form.find('input[type="text"], input[name*="name"], textarea').length > 0;
    const hasSubmit = $form.find('button[type="submit"], input[type="submit"]').length > 0;

    if ((hasEmail || hasText) && hasSubmit) {
      hasContactForm = true;
    } else if ($form.attr('action')?.includes('contact') || $form.attr('id')?.includes('contact')) {
      hasContactForm = true;
    }
  });

  return {
    hasContactForm,
    hasLiveChat,
    hasClickToCall,
    hasSecureSSL
  };
}
