"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";

interface AutomationSettingsShape {
    autoSendEnabled: boolean;
    dryRun: boolean;
    dailyCap: number;
    businessHoursEnabled: boolean;
    startHour: number;
    endHour: number;
    timezone: string;
    updatedAt: string;
}

type EditableKey =
    | "autoSendEnabled"
    | "dryRun"
    | "dailyCap"
    | "businessHoursEnabled"
    | "startHour"
    | "endHour";

type Draft = Pick<AutomationSettingsShape, EditableKey>;

const EDITABLE_KEYS: EditableKey[] = [
    "autoSendEnabled",
    "dryRun",
    "dailyCap",
    "businessHoursEnabled",
    "startHour",
    "endHour",
];

const DAILY_CAPS = [5, 10, 20, 30, 50, 100];

/** Preset used when the optional business-hours window is switched on. */
const BUSINESS_START_HOUR = 9;
const BUSINESS_END_HOUR = 18;

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

function toDraft(settings: AutomationSettingsShape): Draft {
    return {
        autoSendEnabled: settings.autoSendEnabled,
        dryRun: settings.dryRun,
        dailyCap: settings.dailyCap,
        businessHoursEnabled: settings.businessHoursEnabled,
        startHour: settings.startHour,
        endHour: settings.endHour,
    };
}

function sameDraft(a: Draft, b: Draft): boolean {
    return EDITABLE_KEYS.every((key) => a[key] === b[key]);
}

/**
 * An unsaved draft lives in sessionStorage rather than React state on purpose:
 * the dashboard re-renders its server tree whenever a new notification arrives
 * (router.refresh), which remounts this card. Edits the user has not saved yet
 * must not disappear with it — that is exactly the "it changed back by itself"
 * feeling this card had.
 */
const DRAFT_KEY = "nextcall:auto-send-draft";

function readDraft(): Draft | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.sessionStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const p = JSON.parse(raw) as Record<string, unknown>;
        if (
            typeof p.autoSendEnabled !== "boolean" ||
            typeof p.dryRun !== "boolean" ||
            typeof p.businessHoursEnabled !== "boolean" ||
            typeof p.dailyCap !== "number" ||
            typeof p.startHour !== "number" ||
            typeof p.endHour !== "number"
        ) {
            return null;
        }
        return {
            autoSendEnabled: p.autoSendEnabled,
            dryRun: p.dryRun,
            dailyCap: p.dailyCap,
            businessHoursEnabled: p.businessHoursEnabled,
            startHour: p.startHour,
            endHour: p.endHour,
        };
    } catch {
        return null;
    }
}

function writeDraft(draft: Draft | null): void {
    if (typeof window === "undefined") return;
    try {
        if (draft) window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
        else window.sessionStorage.removeItem(DRAFT_KEY);
    } catch {
        // Private mode / storage disabled: the draft simply stays in memory.
    }
}

/**
 * Auto-send controls.
 *
 * Edits stay local until "Save changes" is pressed, so a half-finished change
 * never reaches the server — and "Saved" only appears after the API has
 * confirmed the values are really stored.
 */
export default function AutoSendSettingsCard() {
    const toast = useToast();
    const [settings, setSettings] = useState<AutomationSettingsShape | null>(null);
    const [draft, setDraft] = useState<Draft | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);
    const [isRunningPass, setIsRunningPass] = useState(false);
    const [lastRun, setLastRun] = useState<string | null>(null);

    // Pure fetches (no setState) so the mount effect below can call them
    // without tripping react-hooks/set-state-in-effect.
    const fetchSettings = useCallback(async (): Promise<AutomationSettingsShape> => {
        const res = await fetch("/api/automation/settings", { cache: "no-store" });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = (await res.json()) as { settings: AutomationSettingsShape };
        return data.settings;
    }, []);

    const load = useCallback(async () => {
        try {
            const loaded = await fetchSettings();
            setSettings(loaded);
            setDraft(readDraft() ?? toDraft(loaded));
            setLoadError(null);
        } catch (err) {
            const message = getErrorMessage(err);
            logger.error("[AutoSendSettings] Load failed:", message);
            setLoadError(message);
            setSettings(null);
            setDraft(null);
        } finally {
            setIsLoading(false);
        }
    }, [fetchSettings]);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            try {
                const loaded = await fetchSettings();
                if (cancelled) return;
                setSettings(loaded);
                setDraft(readDraft() ?? toDraft(loaded));
                setLoadError(null);
            } catch (err) {
                if (cancelled) return;
                const message = getErrorMessage(err);
                logger.error("[AutoSendSettings] Load failed:", message);
                setLoadError(message);
                setSettings(null);
                setDraft(null);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        void run();
        return () => { cancelled = true; };
    }, [fetchSettings]);

    const retry = () => {
        setIsLoading(true);
        void load();
    };

    const isDirty = Boolean(settings && draft && !sameDraft(toDraft(settings), draft));

    const update = (patch: Partial<Draft>) => {
        if (!draft) return;
        const next: Draft = { ...draft, ...patch };
        writeDraft(next);
        setDraft(next);
        setSaveError(null);
    };

    const save = async () => {
        if (!settings || !draft || isSaving) return;
        setIsSaving(true);
        setSaveError(null);
        try {
            const res = await fetch("/api/automation/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    autoSendEnabled: draft.autoSendEnabled,
                    dryRun: draft.dryRun,
                    dailyCap: draft.dailyCap,
                    businessHoursEnabled: draft.businessHoursEnabled,
                    startHour: draft.startHour,
                    endHour: draft.endHour,
                }),
            });

            const data = (await res.json().catch(() => null)) as
                | { settings?: AutomationSettingsShape; error?: string; details?: unknown }
                | null;

            if (!res.ok || !data?.settings) {
                // A few validators answer before zod runs; keep the message short.
                const details =
                    typeof data?.details === "string"
                        ? data.details
                        : data?.details
                          ? JSON.stringify(data.details).slice(0, 200)
                          : null;
                throw new Error(data?.error ? `${data.error}${details ? ` — ${details}` : ""}` : `Request failed (${res.status})`);
            }

            setSettings(data.settings);
            setDraft(toDraft(data.settings));
            writeDraft(null);
            toast.success("Saved", "These settings are stored and apply to the next send.");
        } catch (err) {
            const message = getErrorMessage(err);
            logger.error("[AutoSendSettings] Save failed:", message);
            setSaveError(message);
            toast.error("Could not save", message);
        } finally {
            setIsSaving(false);
        }
    };

    const runNow = async () => {
        if (isRunningPass) return;
        setIsRunningPass(true);
        setSaveError(null);
        try {
            const res = await fetch("/api/automation/sweep", { method: "POST" });
            const data = (await res.json().catch(() => null)) as
                | {
                      autoSend?: { sent: number; candidates: number; skipped: string; dryRun: boolean } | null;
                      error?: string;
                      reason?: string;
                  }
                | null;

            if (!res.ok) {
                throw new Error(data?.reason || data?.error || `Request failed (${res.status})`);
            }

            const pass = data?.autoSend;
            if (!pass) throw new Error("The pass returned no auto-send result.");

            if (pass.dryRun) {
                const message = `${pass.candidates} prospect(s) would get an email. Test mode is ON, so nothing was sent.`;
                setLastRun(`Test mode — ${message}`);
                toast.info("TEST MODE: nothing was sent", message);
            } else if (pass.sent > 0) {
                const message = `${pass.sent} email(s) sent (out of ${pass.candidates} prospect(s) waiting).`;
                setLastRun(`Just now — ${message}`);
                toast.success("Audit emails sent", message);
            } else {
                const message = pass.skipped || "No prospect was waiting for an email.";
                setLastRun(`Just now — ${message}`);
                toast.info("Nothing to send right now", message);
            }
        } catch (err) {
            const message = getErrorMessage(err);
            logger.error("[AutoSendSettings] Manual pass failed:", message);
            setSaveError(message);
            toast.error("Sending failed", message);
        } finally {
            setIsRunningPass(false);
        }
    };

    const isLive = draft?.autoSendEnabled === true && draft?.dryRun === false;
    const isDryRunOnly = draft?.autoSendEnabled === true && draft?.dryRun === true;

    const savedAt =
        settings && settings.updatedAt !== new Date(0).toISOString()
            ? new Date(settings.updatedAt).toLocaleString()
            : null;

    const status = isLoading
        ? "Loading..."
        : isSaving
          ? "Saving..."
          : isDirty
            ? "Unsaved changes"
            : savedAt
              ? `Saved ${savedAt}`
              : "Nothing saved yet";

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span aria-hidden>📨</span>
                    <CardTitle className="text-sm font-semibold">Auto-send new audits</CardTitle>
                </div>
                <span
                    className={cn(
                        "text-xs",
                        isDirty ? "font-medium text-amber-700" : "text-muted-foreground"
                    )}
                >
                    {status}
                </span>
            </CardHeader>
            <CardContent className="space-y-4">
                {isLoading && <p className="text-sm text-muted-foreground">Loading auto-send settings...</p>}

                {!isLoading && loadError && (
                    <div className="flex flex-col gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                        <span>Could not load the saved settings: {loadError}</span>
                        <div>
                            <Button variant="outline" size="sm" onClick={retry}>
                                Retry
                            </Button>
                        </div>
                    </div>
                )}

                {!isLoading && draft && settings && (
                    <>
                        <div className={cn(
                            "rounded-md border px-3 py-2 text-xs",
                            isLive
                                ? "border-amber-300 bg-amber-50 text-amber-900"
                                : isDryRunOnly
                                  ? "border-amber-300 bg-amber-50 text-amber-900"
                                  : "border-border bg-muted/40 text-muted-foreground"
                        )}>
                            {isLive
                                ? `LIVE — real emails are being sent. Up to ${draft.dailyCap} a day, ${draft.businessHoursEnabled ? `only between ${hourLabel(BUSINESS_START_HOUR)} and ${hourLabel(BUSINESS_END_HOUR)} ${settings.timezone}` : "at any hour"}.`
                                : isDryRunOnly
                                  ? "TEST MODE — no email is being sent. Every new prospect only shows up in the notifications feed as a preview. To start sending for real: switch TEST MODE off and press Save."
                                  : "OFF — no email is sent by itself. Nothing happens until you switch Auto-send on."}
                        </div>

                        <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2">
                            <span className="text-xs text-muted-foreground">
                                Sends by itself every 15 minutes (follow-ups + new audit emails).
                                {lastRun ? ` ${lastRun}` : " Not run by hand yet."}
                            </span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => { void runNow(); }}
                                disabled={isRunningPass}
                                className="shrink-0"
                            >
                                {isRunningPass ? "Sending..." : "Send now"}
                            </Button>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Auto-send</span>
                                <span className="text-xs text-muted-foreground">
                                    OFF: nothing is emailed by itself. ON: every new prospect gets the audit email automatically.
                                </span>
                            </div>
                            <Button
                                variant={draft.autoSendEnabled ? "default" : "outline"}
                                size="sm"
                                aria-pressed={draft.autoSendEnabled}
                                onClick={() => update({ autoSendEnabled: !draft.autoSendEnabled })}
                            >
                                {draft.autoSendEnabled ? "On" : "Off"}
                            </Button>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Test mode (don&apos;t send yet)</span>
                                <span className="text-xs text-muted-foreground">
                                    ON: nothing leaves your account — you only see what WOULD be sent. OFF: the emails are really sent.
                                </span>
                            </div>
                            <Button
                                variant={draft.dryRun ? "default" : "outline"}
                                size="sm"
                                aria-pressed={draft.dryRun}
                                onClick={() => update({ dryRun: !draft.dryRun })}
                            >
                                {draft.dryRun ? "On" : "Off"}
                            </Button>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Max emails per day</span>
                                <span className="text-xs text-muted-foreground">
                                    Never send more than this in one day. The Resend free plan allows 100 a day.
                                </span>
                            </div>
                            <select
                                value={draft.dailyCap}
                                onChange={(e) => update({ dailyCap: Number(e.target.value) })}
                                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                                aria-label="Max emails per day"
                            >
                                {DAILY_CAPS.map(cap => (
                                    <option key={cap} value={cap}>{cap}/day</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Sending hours</span>
                                <span className="text-xs text-muted-foreground">
                                    {draft.businessHoursEnabled
                                        ? `Only between ${hourLabel(BUSINESS_START_HOUR)} and ${hourLabel(BUSINESS_END_HOUR)} (${settings.timezone}).`
                                        : `Any hour of the day, all 24 hours (${settings.timezone}).`}
                                </span>
                            </div>
                            <select
                                value={draft.businessHoursEnabled ? "business" : "anytime"}
                                onChange={(e) => update(
                                    e.target.value === "business"
                                        ? {
                                            businessHoursEnabled: true,
                                            startHour: BUSINESS_START_HOUR,
                                            endHour: BUSINESS_END_HOUR,
                                        }
                                        : { businessHoursEnabled: false }
                                )}
                                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                                aria-label="Sending hours"
                            >
                                <option value="anytime">Any time (24 hours)</option>
                                <option value="business">Business hours (9am-6pm)</option>
                            </select>
                        </div>

                        {saveError && (
                            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                                NOT saved: {saveError}
                            </p>
                        )}

                        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                            <span className="text-xs text-muted-foreground">
                                {isDirty
                                    ? "You have unsaved changes — press Save to store them."
                                    : "Everything here is saved."}
                            </span>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!isDirty || isSaving}
                                    onClick={() => { writeDraft(null); setDraft(toDraft(settings)); setSaveError(null); }}
                                >
                                    Undo
                                </Button>
                                <Button
                                    size="sm"
                                    disabled={!isDirty || isSaving}
                                    onClick={() => { void save(); }}
                                >
                                    {isSaving ? "Saving..." : "Save"}
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
