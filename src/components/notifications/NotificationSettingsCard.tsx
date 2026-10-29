"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { NotificationSettings, NotificationType } from "@/types";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import {
    CRITICAL_NOTIFICATION_TYPES,
    NOTIFICATION_ICONS,
    NOTIFICATION_LABELS,
    NOTIFICATION_TYPES,
} from "@/lib/notificationTypes";

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

function hourLabel(hour: number): string {
    return `${String(hour).padStart(2, "0")}:00`;
}

function draftOf(settings: NotificationSettings): NotificationSettings {
    return { ...settings, enabled: { ...settings.enabled } };
}

function sameSettings(a: NotificationSettings, b: NotificationSettings): boolean {
    return (
        a.quietHoursEnabled === b.quietHoursEnabled &&
        a.quietStartHour === b.quietStartHour &&
        a.quietEndHour === b.quietEndHour &&
        NOTIFICATION_TYPES.every((type) => a.enabled[type] === b.enabled[type])
    );
}

/**
 * An unsaved draft lives in sessionStorage rather than React state on purpose:
 * the dashboard re-renders its server tree whenever a new notification arrives
 * (router.refresh), which remounts this card. Edits the user has not saved yet
 * must not disappear with it.
 */
const DRAFT_KEY = "nextcall:notification-settings-draft";

type DraftFields = Pick<
    NotificationSettings,
    "enabled" | "quietHoursEnabled" | "quietStartHour" | "quietEndHour"
>;

function readDraft(): DraftFields | null {
    if (typeof window === "undefined") return null;
    try {
        const raw = window.sessionStorage.getItem(DRAFT_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        if (
            typeof parsed.quietHoursEnabled !== "boolean" ||
            typeof parsed.quietStartHour !== "number" ||
            typeof parsed.quietEndHour !== "number"
        ) {
            return null;
        }

        const storedEnabled = (parsed.enabled ?? {}) as Record<string, unknown>;
        const enabled = {} as Record<NotificationType, boolean>;
        for (const type of NOTIFICATION_TYPES) {
            const value = storedEnabled[type];
            if (typeof value !== "boolean") return null;
            enabled[type] = value;
        }

        return {
            enabled,
            quietHoursEnabled: parsed.quietHoursEnabled,
            quietStartHour: parsed.quietStartHour,
            quietEndHour: parsed.quietEndHour,
        };
    } catch {
        return null;
    }
}

function writeDraft(settings: NotificationSettings | null): void {
    if (typeof window === "undefined") return;
    try {
        if (settings) {
            window.sessionStorage.setItem(
                DRAFT_KEY,
                JSON.stringify({
                    enabled: settings.enabled,
                    quietHoursEnabled: settings.quietHoursEnabled,
                    quietStartHour: settings.quietStartHour,
                    quietEndHour: settings.quietEndHour,
                })
            );
        } else {
            window.sessionStorage.removeItem(DRAFT_KEY);
        }
    } catch {
        // Private mode / storage disabled: the draft simply stays in memory.
    }
}

/** Stored settings with any unsaved draft laid over the top. */
function restoreDraft(base: NotificationSettings): NotificationSettings {
    const stored = readDraft();
    if (!stored) return draftOf(base);
    return { ...base, ...stored, enabled: { ...base.enabled, ...stored.enabled } };
}

/**
 * Per-event notification switches + quiet hours, stored server-side.
 *
 * Edits are held locally until "Save changes" is pressed, and "Saved" only
 * appears once the API has confirmed the values are really stored.
 */
export default function NotificationSettingsCard() {
    const toast = useToast();
    const [settings, setSettings] = useState<NotificationSettings | null>(null);
    const [draft, setDraft] = useState<NotificationSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [saveError, setSaveError] = useState<string | null>(null);

    // Pure fetches (no setState) so the mount effect below can call them
    // without tripping react-hooks/set-state-in-effect.
    const fetchSettings = useCallback(async (): Promise<NotificationSettings> => {
        const res = await fetch("/api/notifications/settings", { cache: "no-store" });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
        const data = (await res.json()) as { settings: NotificationSettings };
        return data.settings;
    }, []);

    const load = useCallback(async () => {
        try {
            const loaded = await fetchSettings();
            setSettings(loaded);
            setDraft(restoreDraft(loaded));
            setLoadError(null);
        } catch (err) {
            const message = getErrorMessage(err);
            logger.error("[NotificationSettings] Load failed:", message);
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
                setDraft(restoreDraft(loaded));
                setLoadError(null);
            } catch (err) {
                if (cancelled) return;
                const message = getErrorMessage(err);
                logger.error("[NotificationSettings] Load failed:", message);
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

    const isDirty = Boolean(settings && draft && !sameSettings(draftOf(settings), draft));

    const update = (patch: Partial<NotificationSettings>) => {
        if (!draft) return;
        const next: NotificationSettings = { ...draft, ...patch };
        writeDraft(next);
        setDraft(next);
        setSaveError(null);
    };

    const toggleType = (type: keyof NotificationSettings["enabled"]) => {
        if (!draft) return;
        update({ enabled: { ...draft.enabled, [type]: !draft.enabled[type] } });
    };

    const save = async () => {
        if (!settings || !draft || isSaving) return;
        setIsSaving(true);
        setSaveError(null);
        try {
            const res = await fetch("/api/notifications/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    enabled: draft.enabled,
                    quietHoursEnabled: draft.quietHoursEnabled,
                    quietStartHour: draft.quietStartHour,
                    quietEndHour: draft.quietEndHour,
                }),
            });

            const data = (await res.json().catch(() => null)) as
                | { settings?: NotificationSettings; error?: string; details?: unknown }
                | null;

            if (!res.ok || !data?.settings) {
                const details =
                    typeof data?.details === "string"
                        ? data.details
                        : data?.details
                          ? JSON.stringify(data.details).slice(0, 200)
                          : null;
                throw new Error(data?.error ? `${data.error}${details ? ` — ${details}` : ""}` : `Request failed (${res.status})`);
            }

            setSettings(data.settings);
            setDraft(draftOf(data.settings));
            writeDraft(null);
            toast.success("Notification settings saved", "The new switches and quiet hours are stored.");
        } catch (err) {
            const message = getErrorMessage(err);
            logger.error("[NotificationSettings] Save failed:", message);
            setSaveError(message);
            toast.error("Notification settings were NOT saved", message);
        } finally {
            setIsSaving(false);
        }
    };

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
              : "In-dashboard feed only";

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span aria-hidden>🔔</span>
                    <CardTitle className="text-sm font-semibold">Notifications</CardTitle>
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
                {isLoading && <p className="text-sm text-muted-foreground">Loading notification settings...</p>}

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

                {!isLoading && settings && draft && (
                    <>
                        <div className="flex flex-col gap-2">
                            <div className="flex items-center justify-between gap-3">
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium">Quiet hours</span>
                                    <span className="text-xs text-muted-foreground">
                                        Routine alerts pause inside this window (replies, bounces and provider problems always get through). Timezone: {settings.timezone}
                                    </span>
                                </div>
                                <Button
                                    variant={draft.quietHoursEnabled ? "default" : "outline"}
                                    size="sm"
                                    aria-pressed={draft.quietHoursEnabled}
                                    onClick={() => update({ quietHoursEnabled: !draft.quietHoursEnabled })}
                                >
                                    {draft.quietHoursEnabled ? "On" : "Off"}
                                </Button>
                            </div>

                            {draft.quietHoursEnabled && (
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-muted-foreground">From</span>
                                    <select
                                        value={draft.quietStartHour}
                                        onChange={(e) => update({ quietStartHour: Number(e.target.value) })}
                                        className="rounded-md border border-input bg-background px-2 py-1"
                                        aria-label="Quiet hours start"
                                    >
                                        {HOURS.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                                    </select>
                                    <span className="text-muted-foreground">to</span>
                                    <select
                                        value={draft.quietEndHour}
                                        onChange={(e) => update({ quietEndHour: Number(e.target.value) })}
                                        className="rounded-md border border-input bg-background px-2 py-1"
                                        aria-label="Quiet hours end"
                                    >
                                        {HOURS.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                                    </select>
                                </div>
                            )}
                        </div>

                        <div className="grid gap-1 sm:grid-cols-2">
                            {NOTIFICATION_TYPES.map(type => {
                                const isOn = draft.enabled[type] !== false;
                                const isCritical = CRITICAL_NOTIFICATION_TYPES.includes(type);
                                return (
                                    <button
                                        key={type}
                                        type="button"
                                        aria-pressed={isOn}
                                        onClick={() => toggleType(type)}
                                        className={cn(
                                            "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-sm transition-colors",
                                            isOn ? "border-border bg-background" : "border-dashed border-border bg-muted/40 text-muted-foreground"
                                        )}
                                    >
                                        <span aria-hidden>{NOTIFICATION_ICONS[type]}</span>
                                        <span className="min-w-0 flex-1 truncate">{NOTIFICATION_LABELS[type]}</span>
                                        {isCritical && (
                                            <span className="rounded bg-amber-100 px-1 py-0.5 text-[10px] font-medium text-amber-800">
                                                always
                                            </span>
                                        )}
                                        <span className={cn(
                                            "h-2 w-2 shrink-0 rounded-full",
                                            isOn ? "bg-emerald-500" : "bg-gray-300"
                                        )} aria-hidden />
                                    </button>
                                );
                            })}
                        </div>

                        {saveError && (
                            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-900">
                                Nothing was saved: {saveError}
                            </p>
                        )}

                        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                            <span className="text-xs text-muted-foreground">
                                {isDirty
                                    ? "Unsaved changes — press Save changes to store them."
                                    : "Everything here matches what is stored."}
                            </span>
                            <div className="flex items-center gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={!isDirty || isSaving}
                                    onClick={() => { writeDraft(null); setDraft(draftOf(settings)); setSaveError(null); }}
                                >
                                    Reset
                                </Button>
                                <Button
                                    size="sm"
                                    disabled={!isDirty || isSaving}
                                    onClick={() => { void save(); }}
                                >
                                    {isSaving ? "Saving..." : "Save changes"}
                                </Button>
                            </div>
                        </div>
                    </>
                )}
            </CardContent>
        </Card>
    );
}
