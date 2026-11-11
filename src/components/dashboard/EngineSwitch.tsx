"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** How often the switch refreshes its own view of the server state. */
const STATUS_POLL_MS = 60_000;
/** How often a live engine sends a keep-alive while the operator works. */
const HEARTBEAT_EVERY_MS = 60_000;

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
 * While ON, the open tab keeps the engine alive with a heartbeat every minute
 * — clicks or scrolling are NOT required (on Render the server-side keep-alive
 * holds the instance awake too). Close the app and the server still honours
 * the full TTL window (90 min on Render) before auto-off, so stepping away or
 * restarting mid-work never lands you on a cold instance.
 */
export function EngineSwitch() {
    const [status, setStatus] = useState<EngineStatus | null>(null);
    const [ttlMinutes, setTtlMinutes] = useState(90);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const onRef = useRef(false);

    useEffect(() => {
        onRef.current = Boolean(status?.on);
    }, [status]);

    const refresh = useCallback(async () => {
        try {
            const res = await fetch("/api/engine", { cache: "no-store" });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const data = (await res.json()) as { ttlMs: number; engine: EngineStatus };
            setStatus(data.engine);
            setTtlMinutes(Math.max(1, Math.round(data.ttlMs / 60_000)));
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

    // The heartbeat keeper: while the engine is ON the open tab sends a
    // heartbeat every minute — clicks or scrolling are NOT required. Closing
    // the app stops the heartbeats; the server then honours its full TTL
    // window (90 min on Render) before auto-off, exactly as the operator
    // asked: work pauses never drop the instance into a spin-down.
    useEffect(() => {
        const beat = async () => {
            if (!onRef.current) return;
            try {
                const res = await fetch("/api/engine", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ action: "heartbeat" }),
                });
                if (res.ok) {
                    const data = (await res.json()) as { ttlMs: number; engine: EngineStatus };
                    setStatus(data.engine);
                    setTtlMinutes(Math.max(1, Math.round(data.ttlMs / 60_000)));
                }
            } catch (err) {
                logger.debug("[EngineSwitch] heartbeat failed:", getErrorMessage(err));
            }
        };

        const timer = window.setInterval(() => { void beat(); }, HEARTBEAT_EVERY_MS);
        return () => window.clearInterval(timer);
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
            const data = (await res.json()) as { ttlMs: number; engine: EngineStatus };
            setStatus(data.engine);
            setTtlMinutes(Math.max(1, Math.round(data.ttlMs / 60_000)));
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
                    : `Turn the engine ON — audit/auto-send/follow-up workers run while you work, and auto-off ${ttlMinutes} minutes after the app closes.`;

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
