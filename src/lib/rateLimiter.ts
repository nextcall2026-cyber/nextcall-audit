import "server-only";
import { NextRequest, NextResponse } from "next/server";

const requestMap = new Map<string, number[]>();

interface RateLimitOptions {
  intervalMs: number;
  maxRequests: number;
}

export function rateLimit(
  request: NextRequest,
  { intervalMs, maxRequests }: RateLimitOptions
): NextResponse | null {
  const ip = request.headers.get('x-forwarded-for') || 
             request.headers.get('x-real-ip') || 
             'local';

  const now = Date.now();
  const windowStart = now - intervalMs;

  const existingTimestamps = (requestMap.get(ip) || []).filter(ts => ts > windowStart);

  if (existingTimestamps.length >= maxRequests) {
    return NextResponse.json(
      { error: "Too many requests. Please slow down." },
      { status: 429 }
    );
  }

  existingTimestamps.push(now);
  requestMap.set(ip, existingTimestamps);

  if (Math.random() < 0.01) {
    for (const [key, timestamps] of requestMap.entries()) {
      const valid = timestamps.filter(ts => ts > windowStart);
      if (valid.length === 0) {
        requestMap.delete(key);
      } else {
        requestMap.set(key, valid);
      }
    }
  }

  return null;
}
