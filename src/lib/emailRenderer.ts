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
 * When an unsubscribeUrl is provided, renders a visible UNSUBSCRIBE button
 * in the footer; otherwise falls back to the reply-based instruction.
 */
export function renderEmailHtml(
  plainTextBody: string,
  trackingUrl?: string,
  ctaLink?: EmailCtaLink,
  unsubscribeUrl?: string
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

  // 5. Unsubscribe action — a real, visible button when a signed URL is
  // provided; otherwise the legacy reply-based instruction.
  const unsubscribeHtml = unsubscribeUrl
    ? `<a href="${escapeHtml(unsubscribeUrl)}" style="display:inline-block; padding: 9px 26px; border: 1px solid #d1d5db; border-radius: 999px; background: #f9fafb; color: #4b5563; font-size: 12px; font-weight: bold; letter-spacing: 0.5px; text-decoration: none;">UNSUBSCRIBE</a>`
    : `If you do not wish to receive further communication, simply reply with "UNSUBSCRIBE".`;

  // 6. Wrap in a professional template with Unsubscribe footer
  return `
    <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
      <p>${formattedBody}</p>
      ${ctaHtml}
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
      <p style="font-size: 10px; color: #999; text-align: center; margin: 0 0 12px;">
        You received this email because we conducted a digital presence audit for your business.
      </p>
      <p style="text-align: center; margin: 0;">
        ${unsubscribeHtml}
      </p>
      ${trackingUrl ? `<img src="${trackingUrl}" width="1" height="1" alt="" style="display:none" />` : ""}
    </div>
  `;
}