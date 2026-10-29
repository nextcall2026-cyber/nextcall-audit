/**
 * Who may trigger the automation sweep.
 *
 * Two callers exist and they authenticate differently:
 *
 *   - An external scheduler (cron-job.org / UptimeRobot) cannot send cookies,
 *     so it passes the shared secret: `x-cron-secret: <CRON_SECRET>` or
 *     `?secret=<CRON_SECRET>`.
 *   - The dashboard (the "Run now" button) sends the normal auth cookie that
 *     the middleware already validates for every /api request.
 *
 * Failing closed matters here: a sweep with auto-send live emails real
 * prospects, so an unauthenticated call must never start one.
 */

export interface SweepAuthInput {
  /** Value of the `x-cron-secret` header, if any. */
  headerSecret: string | null;
  /** Value of the `secret` query parameter, if any. */
  querySecret: string | null;
  /** Value of the `nextcall_auth` cookie, if any. */
  authCookie: string | null;
  /** process.env.CRON_SECRET */
  cronSecret: string | undefined;
  /** process.env.APP_PASSWORD */
  appPassword: string | undefined;
}

export type SweepAuthResult =
  | { ok: true; via: "cron-secret" | "dashboard" }
  | { ok: false; reason: string };

export function authorizeSweep(input: SweepAuthInput): SweepAuthResult {
  const { headerSecret, querySecret, authCookie, cronSecret, appPassword } = input;
  const providedSecret = headerSecret ?? querySecret;

  if (cronSecret && providedSecret && providedSecret === cronSecret) {
    return { ok: true, via: "cron-secret" };
  }

  if (appPassword && authCookie && authCookie === appPassword) {
    return { ok: true, via: "dashboard" };
  }

  if (!cronSecret && !appPassword) {
    return { ok: false, reason: "Neither CRON_SECRET nor APP_PASSWORD is configured." };
  }

  if (providedSecret && !cronSecret) {
    return { ok: false, reason: "CRON_SECRET is not configured on the server." };
  }

  return { ok: false, reason: "Missing or wrong cron secret, and no dashboard session." };
}