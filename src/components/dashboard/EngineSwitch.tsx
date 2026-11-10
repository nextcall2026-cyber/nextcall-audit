"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** How often the switch refreshes its own view of the server state. */
const STATUS_POLL_MS = 60_000;
/** How often a live engine sends a keep-alive while the operator works. */
const HEARTBEAT_EVERY_MS = 60_000;
/** The keeper only counts the tab as "at work" when interaction happened inside this window. */
const ACTIVITY_WINDOW_MS = 10 * 60 * 1000;

interface EngineStatus {
  on: boolean;
  live: boolean;
  reason: string;
  lastHeartbeatAt: string | null;
  lastOffAt: string | null;
  lastOffReason: string | null;
}

/**
 * The ENGINE switch for the dashboard header.
 *
 * One button: press it when you start working, press it again when you stop.
 * While ON, this component keeps the engine alive with heartbeats — but only
 * while the tab is visible AND the operator actually interacts (clicks, keys,
 * scroll). Close the window, hide the tab, or walk away for 30 minutes and the
 * server stops seeing heartbeats — every scheduled worker then sees the engine
 * as OFF all by itself, with nothing to clean up.
 */
export function EngineSwitch() {
    const [status, setStatus] = useState<EngineStatus | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const onRef = useRef(false);
    const lastActivityRef = useRef(Date.now());

    useEffect(() => {
        onRef.current = Boolean(status?.on);
    }, [status]);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch("/api/engine", { cache: "no-store" });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const data = (await res.json()) as { engine: EngineStatus };
            setStatus(data.engine);
            setError(null);
        } catch (err) {
            // The header keeps the last known state; the next poll retries.
            logger.debug("[EngineSwitch] status fetch failed:", getErrorMessage(err));
        }
    }, []);

    useEffect(() => {
        void refresh();
        const poll = window.setInterval(() => { void refresh(); }, STATUS_POLL_MS);
        return () => window.clearInterval(poll);
    }, [refresh]);

    // The activity keeper: real interaction sends heartbeats; a hidden tab or
    // an untouched window does not. The server expires the engine after 30
    // minutes without a heartbeat — window closed, laptop asleep, power cut,
    // everything ends in the same safe place.
    useEffect(() => {
        const markActivity = () => { lastActivityRef.current = Date.now(); };
        const events = ["pointerdown", "keydown", "wheel", "touchstart"] as const;
        events.forEach((event) =>
            window.addEventListener(event, markActivity, { passive: true, capture: true })
        );

        const beat = async () => {
            if (!onRef.current) return;
            if (document.visibilityState !== "visible") return;
            if (Date.now() - lastActivityRef.current > ACTIVITY_WINDOW_MS) return;
            try {
                const res = await fetch("/api/engine", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "heartbeat" }),
                });
                if (res.ok) {
                    const data = (await res.json()) as { engine: EngineStatus };
                    setStatus(data.engine);
                }
            } catch (err) {
                logger.debug("[EngineSwitch] heartbeat failed:", getErrorMessage(err));
            }
        };

        const timer = window.setInterval(() => { void beat(); }, HEARTBEAT_EVERY_MS);
        return () => {
            events.forEach((event) =>
                window.removeEventListener(event, markActivity, { capture: true })
            );
            window.clearInterval(timer);
        };
    }, []);

    const setEngine = async (action: "on" | "off") => {
        setBusy(true);
        setError(null);
        try {
            const res = await fetch("/api/engine", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ action }),
            });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const data = (await res.json()) as { engine: EngineStatus };
            setStatus(data.engine);
            lastActivityRef.current = Date.now();
        } catch (err) {
            setError(getErrorMessage(err) ?? "Engine switch failed");
        } finally {
            setBusy(false);
        }
    };

    const live = Boolean(status?.on && status?.live);
    const label = !status ? "ENGINE …" : live ? "ENGINE ON" : status.on ? "ENGINE IDLE" : "ENGINE OFF";
    const title = error
        ? `Engine switch error: ${error}`
        : !status
            ? "Loading engine status…"
            : live
                ? "Workers are running. Click to turn the engine OFF — scheduled workers stop, manual actions keep working."
                : status.on
                    ? "Engine is ON but no activity reached the server — it will switch itself OFF. Click to keep working."
                    : "Turn the engine ON — audit/auto-send/follow-up workers run while you work, and auto-off after 30 minutes without activity.";

    return (
        <button
            type="button"
            onClick={() => void setEngine(live || status?.on ? "off" : "on")}
            disabled={busy || !status}
            aria-pressed={live}
            title={title}
            className={cn(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-semibold tracking-wide transition-colors disabled:opacity-60",
                !status
                    ? "border-[#2b3948] bg-[#10171e] text-muted-foreground"
                    : live
                        ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                        : status.on
                            ? "border-amber-500/60 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20"
                            : "border-[#2b3948] bg-[#10171e] text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            )}
        >
            <span
                aria-hidden
                className={cn(
                    "h-2 w-2 rounded-full",
                    live
                        ? "bg-emerald-400 motion-safe:animate-pulse"
                        : status?.on
                            ? "bg-amber-400"
                            : "bg-muted-foreground/60"
                )}
            />
            {label}
        </button>
    );
}
