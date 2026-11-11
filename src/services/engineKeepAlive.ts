import "server-only";

import { engineStateService } from "@/services/engineStateService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * The Render keep-alive: while the engine is ON, the server pings itself every
 * 10 minutes so Render's 15-minute idle spin-down never fires mid-work.
 *
 * RENDER_EXTERNAL_URL is injected by Render itself and is absent everywhere
 * else, so on Vercel (or local dev) this scheduler silently does nothing.
 *
 * The ping is deliberately UNauthenticated (GET /login) — it exists purely to
 * reset Render's idle timer and must never extend the engine's own TTL: when
 * the TTL window (ENGINE_TTL_MINUTES, 90 on Render) expires, isAutomationLive
 * turns false, the ping stops, and the instance spins down on its own.
 */

const KEEP_ALIVE_INTERVAL_MS = 10 * 60 * 1000;

export function startEngineKeepAlive(): void {
  const baseUrl = process.env.RENDER_EXTERNAL_URL;
  if (!baseUrl) {
    logger.debug(
      "[EngineKeepAlive] RENDER_EXTERNAL_URL is not set — keep-alive disabled (not running on Render)."
    );
    return;
  }

  setInterval(() => {
    void (async () => {
      try {
        const engine = await engineStateService.isAutomationLive();
        if (!engine.live) {
          logger.debug("[EngineKeepAlive] Engine off — letting the instance sleep.");
          return;
        }

        await fetch(`${baseUrl}/login`, { method: "GET" }).catch(() => undefined);
        logger.info("[EngineKeepAlive] Engine ON — keep-alive ping sent.");
      } catch (error) {
        logger.warn("[EngineKeepAlive] Keep-alive tick failed:", getErrorMessage(error));
      }
    })();
  }, KEEP_ALIVE_INTERVAL_MS);

  logger.info(
    `[EngineKeepAlive] Started — pinging ${baseUrl}/login every 10 min while the engine is ON.`
  );
}
