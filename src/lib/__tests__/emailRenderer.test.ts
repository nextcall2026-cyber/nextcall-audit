import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { renderEmailHtml } from '@/lib/emailRenderer';

describe('emailRenderer', () => {
  it('should escape HTML special characters to prevent XSS', () => {
    const maliciousInput = `<script>alert('XSS')</script>`;
    const html = renderEmailHtml(maliciousInput);
    
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });

  it('should convert newlines to <br> tags', () => {
    const plainText = `Hello,\n\nThis is a test.`;
    const html = renderEmailHtml(plainText);
    
    expect(html).toContain('Hello,<br><br>This is a test.');
  });

  it('should include the unsubscribe footer', () => {
    const html = renderEmailHtml('Test body');
    expect(html).toContain('UNSUBSCRIBE');
  });

  it('should render a clickable CTA for http(s) URLs', () => {
    const html = renderEmailHtml('Body', undefined, {
      label: 'Try NextCall free for 3 days',
      url: 'https://getnextcall.com/',
    });
    expect(html).toContain('href="https://getnextcall.com/"');
    expect(html).toContain('Try NextCall free for 3 days');
    expect(html).toContain('target="_blank"');
  });

  it('should escape CTA label and URL', () => {
    const html = renderEmailHtml('Body', undefined, {
      label: '<b>yay</b> & bye',
      url: 'https://example.com/?a=1&b=2',
    });
    expect(html).toContain('&lt;b&gt;yay&lt;/b&gt; &amp; bye');
    expect(html).toContain('href="https://example.com/?a=1&amp;b=2"');
  });

  it('should drop non-http(s) CTA URLs', () => {
    const html = renderEmailHtml('Body', undefined, {
      label: 'Click',
      url: 'javascript:alert(1)',
    });
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('href=');
    expect(html).toContain('Body');
  });

  it('should not modify output when no CTA is provided', () => {
    const withCta = renderEmailHtml('Body', undefined, {
      label: 'Go',
      url: 'https://example.com',
    });
    const without = renderEmailHtml('Body');
    expect(without).not.toContain('href=');
    expect(without).toContain('Body');
    expect(withCta).toContain('href="https://example.com"');
  });
});
