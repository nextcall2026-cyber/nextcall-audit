import { describe, it, expect, vi, beforeEach } from 'vitest';
vi.mock('server-only', () => ({}));
import { validateUrlForCrawling } from '@/lib/urlValidator';
import { promises as dns } from 'dns';

vi.mock('dns', () => ({
  promises: {
    resolve4: vi.fn(),
  },
}));

describe('urlValidator (SSRF Protection)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should allow public domains', async () => {
    (dns.resolve4 as any).mockResolvedValue(['8.8.8.8']);
    
    const result = await validateUrlForCrawling('https://example.com');
    expect(result.isValid).toBe(true);
    expect(result.normalizedUrl).toBe('https://example.com/');
  });

  it('should block domains resolving to private IPs (192.168.x.x)', async () => {
    (dns.resolve4 as any).mockResolvedValue(['192.168.1.1']);
    
    const result = await validateUrlForCrawling('https://internal.example.com');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('SSRF Protection');
  });

  it('should block domains resolving to loopback IPs (127.x.x.x)', async () => {
    (dns.resolve4 as any).mockResolvedValue(['127.0.0.1']);
    
    const result = await validateUrlForCrawling('https://localhost.example.com');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('SSRF Protection');
  });

  it('should block invalid protocols (file://)', async () => {
    const result = await validateUrlForCrawling('file:///etc/passwd');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('Invalid protocol');
  });

  it('should block unresolvable domains', async () => {
    const err = new Error('ENOTFOUND') as any;
    err.code = 'ENOTFOUND';
    (dns.resolve4 as any).mockRejectedValue(err);
    
    const result = await validateUrlForCrawling('https://this-domain-does-not-exist.com');
    expect(result.isValid).toBe(false);
    expect(result.error).toContain('DNS resolution failed');
  });
});
