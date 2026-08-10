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
});
