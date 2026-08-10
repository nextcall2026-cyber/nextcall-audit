import "server-only";
import { promises as dns } from "dns";
import { logger } from "@/lib/logger";

export interface ValidationResult {
  isValid: boolean;
  normalizedUrl?: string;
  error?: string;
}

/**
 * Checks if an IPv4 address is private, loopback, or link-local.
 * Returns true if the IP is blocked (unsafe).
 */
function isUnsafeIPv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(isNaN)) return true; // Invalid IP format

  const [a, b] = parts;

  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10.0.0.0/8 (Private)
    (a === 172 && b >= 16 && b <= 31) || // 172.16.0.0/12 (Private)
    (a === 192 && b === 168) || // 192.168.0.0/16 (Private)
    a === 127 || // 127.0.0.0/8 (Loopback)
    (a === 169 && b === 254) // 169.254.0.0/16 (Link-local)
  );
}

/**
 * Validates a URL, checks DNS records to prevent SSRF, and normalizes the URL.
 */
export async function validateUrlForCrawling(rawUrl: string): Promise<ValidationResult> {
  try {
    // 1. Parse URL
    const parsedUrl = new URL(rawUrl);

    // 2. Validate Scheme
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { isValid: false, error: 'Invalid protocol. Only HTTP/HTTPS allowed.' };
    }

    // 3. Normalize Domain (remove www for consistent crawling)
    let hostname = parsedUrl.hostname.replace(/^www\./, '');
    
    // 4. SSRF Protection: DNS Lookup and IP Validation
    try {
      // Resolve IPv4 addresses (A records)
      const addresses = await dns.resolve4(hostname);
      
      for (const ip of addresses) {
        if (isUnsafeIPv4(ip)) {
          logger.warn(`[URLValidator] Blocked unsafe IP attempt: ${hostname} -> ${ip}`);
          return { isValid: false, error: `SSRF Protection: Domain resolves to private/internal IP.` };
        }
      }
    } catch (dnsError: any) {
      // If DNS resolution fails (e.g., ENOTFOUND), we can't fetch it safely
      if (dnsError.code === 'ENOTFOUND') {
        return { isValid: false, error: 'DNS resolution failed: Domain not found.' };
      }
      // If it's an IPv6 only domain or other DNS issue, we err on the side of caution for MVP
      return { isValid: false, error: `DNS resolution error: ${dnsError.message}` };
    }

    // 5. Construct Normalized URL (force HTTPS if possible, strip tracking params if needed later)
    const normalizedUrl = `${parsedUrl.protocol}//${hostname}${parsedUrl.pathname}${parsedUrl.search}`;
    
    return { isValid: true, normalizedUrl };
  } catch (error: any) {
    return { isValid: false, error: `Invalid URL format: ${error.message}` };
  }
}