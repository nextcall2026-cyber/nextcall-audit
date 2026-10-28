"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

/**
 * Auto-send controls. Both switches start OFF (auto-send disabled, dry run
 * on), so going live is always two deliberate clicks.
 */
export default function AutoSendSettingsCard() {
    const [settings, setSettings] = useState<AutomationSettingsShape | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;

        const run = async () => {
            try {
                const res = await fetch("/api/automation/settings");
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = (await res.json()) as { settings: AutomationSettingsShape };
                if (cancelled) return;
                setSettings(data.settings);
            } catch (err) {
                logger.error("[AutoSendSettings] Load failed:", getErrorMessage(err));
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        void run();
        return () => { cancelled = true; };
    }, []);

    const save = async (patch: Partial<AutomationSettingsShape>) => {
        if (!settings) return;
        setSettings({ ...settings, ...patch });
        setIsSaving(true);
        try {
            const res = await fetch("/api/automation/settings", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(patch),
            });
            if (!res.ok) throw new Error(`Request failed (${res.status})`);
            const data = (await res.json()) as { settings: AutomationSettingsShape };
            setSettings(data.settings);
            setSavedAt(new Date().toLocaleTimeString());
        } catch (err) {
            logger.error("[AutoSendSettings] Save failed:", getErrorMessage(err));
        } finally {
            setIsSaving(false);
        }
    };

    const isLive = settings?.autoSendEnabled === true && settings?.dryRun === false;

    return (
        <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                    <span aria-hidden>📨</span>
                    <CardTitle className="text-sm font-semibold">Auto-send new audits</CardTitle>
                </div>
                <span className="text-xs text-muted-foreground">
                    {isSaving ? "Saving..." : savedAt ? `Saved ${savedAt}` : "Runs on the automation sweep"}
                </span>
            </CardHeader>
            <CardContent className="space-y-4">
                {isLoading && <p className="text-sm text-muted-foreground">Loading auto-send settings...</p>}

                {!isLoading && settings && (
                    <>
                        <div className={cn(
                            "rounded-md border px-3 py-2 text-xs",
                            isLive
                                ? "border-amber-300 bg-amber-50 text-amber-900"
                                : "border-border bg-muted/40 text-muted-foreground"
                        )}>
                            {isLive
                                ? "LIVE — new prospects will be emailed automatically (business hours + daily cap apply)."
                                : "Not sending: auto-send is off or in dry run. Dry run writes a feed entry instead of sending."}
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Auto-send enabled</span>
                                <span className="text-xs text-muted-foreground">
                                    Master switch. When off, nothing is emailed automatically.
                                </span>
                            </div>
                            <Button
                                variant={settings.autoSendEnabled ? "default" : "outline"}
                                size="sm"
                                onClick={() => { void save({ autoSendEnabled: !settings.autoSendEnabled }); }}
                            >
                                {settings.autoSendEnabled ? "On" : "Off"}
                            </Button>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Dry run</span>
                                <span className="text-xs text-muted-foreground">
                                    Recommended first: see which emails would go out without sending any.
                                </span>
                            </div>
                            <Button
                                variant={settings.dryRun ? "default" : "outline"}
                                size="sm"
                                onClick={() => { void save({ dryRun: !settings.dryRun }); }}
                            >
                                {settings.dryRun ? "On" : "Off"}
                            </Button>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Daily cap</span>
                                <span className="text-xs text-muted-foreground">
                                    Maximum initial emails per day (Resend free tier allows 100/day).
                                </span>
                            </div>
                            <select
                                value={settings.dailyCap}
                                onChange={(e) => { void save({ dailyCap: Number(e.target.value) }); }}
                                className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                                aria-label="Daily cap"
                            >
                                {[5, 10, 20, 30, 50, 100].map(cap => (
                                    <option key={cap} value={cap}>{cap}/day</option>
                                ))}
                            </select>
                        </div>

                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col">
                                <span className="text-sm font-medium">Business hours only</span>
                                <span className="text-xs text-muted-foreground">
                                    Send between the hours below ({settings.timezone}).
                                </span>
                            </div>
                            <Button
                                variant={settings.businessHoursEnabled ? "default" : "outline"}
                                size="sm"
                                onClick={() => { void save({ businessHoursEnabled: !settings.businessHoursEnabled }); }}
                            >
                                {settings.businessHoursEnabled ? "On" : "Off"}
                            </Button>
                        </div>

                        {settings.businessHoursEnabled && (
                            <div className="flex items-center gap-2 text-sm">
                                <span className="text-muted-foreground">From</span>
                                <select
                                    value={settings.startHour}
                                    onChange={(e) => { void save({ startHour: Number(e.target.value) }); }}
                                    className="rounded-md border border-input bg-background px-2 py-1"
                                    aria-label="Business hours start"
                                >
                                    {HOURS.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                                </select>
                                <span className="text-muted-foreground">to</span>
                                <select
                                    value={settings.endHour}
                                    onChange={(e) => { void save({ endHour: Number(e.target.value) }); }}
                                    className="rounded-md border border-input bg-background px-2 py-1"
                                    aria-label="Business hours end"
                                >
                                    {HOURS.map(hour => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
                                </select>
                            </div>
                        )}
                    </>
                )}
            </CardContent>
        </Card>
    );
}
