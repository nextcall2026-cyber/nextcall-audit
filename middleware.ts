import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Allow access to the login page and login API
  if (pathname.startsWith('/login') || pathname.startsWith('/api/login')) {
    return NextResponse.next();
  }

  // 2. Allow access to Resend Webhooks (they use signature verification, not cookies)
  if (pathname.startsWith('/api/webhooks')) {
    return NextResponse.next();
  }

  // 2b. Allow the email open-tracking pixel: email recipients' mail clients
  // request this URL without any auth cookie. It only marks a known
  // outreach record as opened.
  if (pathname.startsWith('/api/tracking')) {
    return NextResponse.next();
  }

  // 2c. Allow the automation endpoints: an external scheduler (cron-job.org,
  // UptimeRobot, Vercel Cron) cannot send a cookie, so it authenticates with
  // the shared CRON_SECRET inside the route instead. The dashboard heartbeat
  // and buttons send the normal cookie and are still checked below.
  if (
    pathname === '/api/automation/sweep' ||
    pathname === '/api/automation/tick'
  ) {
    const cronSecret = process.env.CRON_SECRET;
    const provided =
      request.headers.get('x-cron-secret') ??
      request.nextUrl.searchParams.get('secret');
    const authorization = request.headers.get('authorization');
    const bearer =
      authorization && authorization.toLowerCase().startsWith('bearer ')
        ? authorization.slice(7).trim()
        : null;
    const cookie = request.cookies.get('nextcall_auth')?.value;
    const appPassword = process.env.APP_PASSWORD;

    if (
      (cronSecret && (provided === cronSecret || bearer === cronSecret)) ||
      (appPassword && cookie === appPassword)
    ) {
      return NextResponse.next();
    }
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // 3. Protect Dashboard and all other APIs
  if (pathname.startsWith('/dashboard') || pathname.startsWith('/api')) {
    const authToken = request.cookies.get('nextcall_auth')?.value;
    const appPassword = process.env.APP_PASSWORD;

    // If no password is configured in env, fail gracefully (or allow in dev)
    if (!appPassword) {
      console.error("MIDDLEWARE: APP_PASSWORD is not set in environment variables.");
      // Block in production to prevent open access if misconfigured
      if (process.env.NODE_ENV === 'production') {
        return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
      }
      return NextResponse.next(); // Allow in dev for convenience if missing
    }

    // If cookie missing or incorrect
    if (authToken !== appPassword) {
      if (pathname.startsWith('/api')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      // Redirect to login for page requests
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
