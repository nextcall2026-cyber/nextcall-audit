import "server-only";

export interface EmailCtaLink {
  label: string;
  url: string;
}

/**
 * Safely converts plain text to HTML and wraps it in a professional email template.
 * Prevents XSS by escaping HTML special characters.
 * Appends an unsubscribe footer for compliance.
 * When a trackingUrl is provided, embeds a 1x1 open-tracking pixel.
 * When a ctaLink is provided, renders a clickable call-to-action button
 * (only for http/https URLs; anything else is dropped).
 */
export function renderEmailHtml(
  plainTextBody: string,
  trackingUrl?: string,
  ctaLink?: EmailCtaLink
): string {
  // 1. Escape HTML special characters to prevent XSS and layout breaking
  const escapeHtml = (text: string) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // 2. Convert newlines to <br> tags for proper email formatting
  const formattedBody = escapeHtml(plainTextBody).replace(/\n/g, '<br>');

  // 3. CTA link — only http/https URLs, escaped for safety
  let ctaHtml = "";
  if (ctaLink && ctaLink.url) {
    try {
      const parsed = new URL(ctaLink.url);
      if (parsed.protocol === "http:" || parsed.protocol === "https:") {
        ctaHtml = `
          <p style="margin-top: 16px;">
            <a href="${escapeHtml(ctaLink.url)}" target="_blank" rel="noopener" style="display:inline-block; background:#1a73e8; color:#ffffff; padding:10px 18px; border-radius:6px; text-decoration:none; font-weight:bold;">
              ${escapeHtml(ctaLink.label)}
            </a>
          </p>`;
      }
    } catch {
      // Invalid URL — omit the CTA rather than emit a broken link
    }
  }

  // 4. Wrap in a professional template with Unsubscribe footer
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <p>${formattedBody}</p>
      ${ctaHtml}
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 10px; color: #999; text-align: center;">
        You received this email because we conducted a digital presence audit for your business. 
        If you do not wish to receive further communication, simply reply with "UNSUBSCRIBE".
      </p>
      ${trackingUrl ? `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:none" />` : ""}
    </div>
  `;
}