"use client";

import { useEffect } from "react";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Keeps automatic sending running without an always-on scheduler.
 *
 * A serverless host has no reliable timer, so while the dashboard is open this
 * pings /api/automation/tick every few minutes. The server decides whether the
 * 15-minute window has passed — the dashboard never sends anything by itself,
 * it only gives the server a chance to.
 *
 * Renders nothing: sending is not a UI action any more.
 */
export function AutomationHeartbeat() {
    useEffect(() => {
        let stopped = false;

        const tick = async () => {
            if (stopped) return;
            try {
                const res = await fetch("/api/automation/tick", { method: "POST" });
                if (!res.ok) {
                    // 401 when the session expired; nothing to do about it here.
                    logger.debug(`[AutomationHeartbeat] tick skipped (${res.status})`);
                }
            } catch (err) {
                logger.debug("[AutomationHeartbeat] tick failed:", getErrorMessage(err));
            }
        };

        void tick();

        const timer = window.setInterval(() => { void tick(); }, HEARTBEAT_INTERVAL_MS);
        const onFocus = () => { void tick(); };
        window.addEventListener("focus", onFocus);

        return () => {
            stopped = true;
            window.clearInterval(timer);
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    return null;
}