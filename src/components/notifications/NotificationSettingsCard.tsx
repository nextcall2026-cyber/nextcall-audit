"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NotificationSettings } from "@/types";
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

/**
 * Per-event notification switches + quiet hours, stored server-side.
 */
export default function NotificationSettingsCard() {
    const [settings, setSettings] = useState<NotificationSettings | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            try {
                const res = await fetch("/api/notifications/settings");
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = (await res.json()) as { settings: NotificationSettings };
                if (cancelled) return;
                setSettings(data.settings);
            } catch (err) {
                logger.error("[NotificationSettings] Load failed:", getErrorMessage(err));
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        void run();
        return () => { cancelled = true; };
    }, []);

    const save = async (patch: Partial<NotificationSettings>) => {
        if (!settings) return;
        const next: NotificationSettings = { ...settings, ...patch };
        setSettings(next);
        setIsSaving(true);
        try {
            const res = await fetch("/api/notifications/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const data = (await res.json()) as { settings: NotificationSettings };
            setSettings(data.settings);
            setSavedAt(new Date().toLocaleTimeString());
        } catch (err) {
            logger.error("[NotificationSettings] Save failed:", getErrorMessage(err));
        } finally {
            setIsSaving(false);
        }
    };

    const toggleType = (type: keyof NotificationSettings["enabled"]) => {
        if (!settings) return;
        void save({ enabled: { ...settings.enabled, [type]: !settings.enabled[type] } });
    };

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span aria-hidden>🔔</span>
                    <CardTitle className="text-sm font-semibold">Notifications</CardTitle>
                </div>
                <span className="text-xs text-muted-foreground">
                    {isSaving ? "Saving..." : savedAt ? `Saved ${savedAt}` : "In-dashboard feed only"}
                </span>
            </CardHeader>
            <CardContent className="space-y-4">
                {isLoading && <p className="text-sm text-muted-foreground">Loading notification settings...</p>}

                {!isLoading && settings && (
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
                                    variant={settings.quietHoursEnabled ? "default" : "outline"}
                                    size="sm"
                                    onClick={() => { void save({ quietHoursEnabled: !settings.quietHoursEnabled }); }}
                                >
                                    {settings.quietHoursEnabled ? "On" : "Off"}
                                </Button>
                            </div>

                            {settings.quietHoursEnabled && (
                                <div className="flex items-center gap-2 text-sm">
                                    <span className="text-muted-foreground">From</span>
                                    <select
                                        value={settings.quietStartHour}
                                        onChange={(e) => { void save({ quietStartHour: Number(e.target.value) }); }}
                                        className="rounded-md border border-input bg-background px-2 py-1"
                                        aria-label="Quiet hours start"
                                    >
                                        {HOURS.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                                    </select>
                                    <span className="text-muted-foreground">to</span>
                                    <select
                                        value={settings.quietEndHour}
                                        onChange={(e) => { void save({ quietEndHour: Number(e.target.value) }); }}
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
                                const isOn = settings.enabled[type] !== false;
                                const isCritical = CRITICAL_NOTIFICATION_TYPES.includes(type);
                                return (
                                    <button
                                        key={type}
                                        type="button"
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
                    </>
                )}
            </CardContent>
        </Card>
    );
}
