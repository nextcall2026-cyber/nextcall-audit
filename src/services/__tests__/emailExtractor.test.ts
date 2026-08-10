import { describe, it, expect } from 'vitest';
import { emailExtractor } from '@/services/emailExtractor';

const mockHtml = (body: string) => `
  <html>
    <head>
      <script type="application/ld+json">
        {
          "@type": "LocalBusiness",
          "email": "info@jsonld-business.com"
        }
      </script>
    </head>
    <body>
      ${body}
    </body>
  </html>
`;

describe('emailExtractor', () => {
  it('should extract emails from mailto links', () => {
    const html = mockHtml('<a href="mailto:hello@mailto-test.com">Email</a>');
    const result = emailExtractor.extract(html, 'https://test.com');
    expect(result.some(e => e.address === 'hello@mailto-test.com')).toBe(true);
  });

  it('should extract emails from JSON-LD with highest confidence', () => {
    const html = mockHtml('<p>Contact us at text@text.com</p>');
    const result = emailExtractor.extract(html, 'https://test.com');
    const jsonLdEmail = result.find(e => e.address === 'info@jsonld-business.com');
    expect(jsonLdEmail).toBeDefined();
    expect(jsonLdEmail?.sourceType).toBe('JSON_LD');
    expect(jsonLdEmail?.confidence).toBe(100);
  });

  it('should reject placeholder emails', () => {
    const html = mockHtml('<a href="mailto:example@example.com">Email</a><p>test@test.com</p>');
    const result = emailExtractor.extract(html, 'https://test.com');
    expect(result.some(e => e.address === 'example@example.com')).toBe(false);
    expect(result.some(e => e.address === 'test@test.com')).toBe(false);
  });

  it('should extract and de-obfuscate emails', () => {
    const html = mockHtml('<p>Contact: support [at] obfuscated [dot] com</p>');
    const result = emailExtractor.extract(html, 'https://test.com');
    expect(result.some(e => e.address === 'support@obfuscated.com')).toBe(true);
  });

  it('should classify business prefixes correctly', () => {
    const html = mockHtml('<a href="mailto:contact@business.com">Email</a>');
    const result = emailExtractor.extract(html, 'https://test.com');
    expect(result[0].type).toBe('BUSINESS');
  });
});
