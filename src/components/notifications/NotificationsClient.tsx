"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { AppNotification } from "@/types";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { formatRelativeTime, iconFor, labelFor } from "@/lib/notificationTypes";

type FeedFilter = "ALL" | "UNREAD";

/**
 * Full notification feed. Polls nothing — it refreshes when opened, when the
 * filter changes, and after any read action (the bell keeps itself current).
 */
export default function NotificationsClient() {
    const [items, setItems] = useState<AppNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [filter, setFilter] = useState<FeedFilter>("ALL");
    const [isLoading, setIsLoading] = useState(true);

    const [reloadTick, setReloadTick] = useState(0);

    useEffect(() => {
        let cancelled = false;

        // Defined inside the effect so the fetch owns its own lifecycle.
        const run = async () => {
            try {
                const query = filter === "UNREAD" ? "&unreadOnly=1" : "";
                const res = await fetch(`/api/notifications?limit=100${query}`);
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = (await res.json()) as {
                    notifications: AppNotification[];
                    unreadCount: number;
                };
                if (cancelled) return;
                setItems(data.notifications ?? []);
                setUnreadCount(data.unreadCount ?? 0);
            } catch (err) {
                logger.error("[NotificationsClient] Fetch failed:", getErrorMessage(err));
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        void run();
        return () => { cancelled = true; };
    }, [filter, reloadTick]);

    const changeFilter = (next: FeedFilter) => {
        if (next === filter) return;
        setIsLoading(true);
        setFilter(next);
    };

    const refresh = () => {
        setIsLoading(true);
        setReloadTick(previous => previous + 1);
    };

    const markRead = async (notification: AppNotification) => {
        if (notification.read) return;
        setItems(prev => prev.map(i => (i.id === notification.id ? { ...i, read: true } : i)));
        setUnreadCount(count => Math.max(0, count - 1));
        try {
            await fetch("/api/notifications", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ ids: [notification.id] }),
            });
        } catch (err) {
            logger.error("[NotificationsClient] Mark read failed:", getErrorMessage(err));
        }
    };

    const markAllRead = async () => {
        setItems(prev => prev.map(i => ({ ...i, read: true })));
        setUnreadCount(0);
        try {
            await fetch("/api/notifications", {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ all: true }),
            });
        } catch (err) {
            logger.error("[NotificationsClient] Mark all read failed:", getErrorMessage(err));
        }
    };

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-2">
                {(["ALL", "UNREAD"] as FeedFilter[]).map(option => (
                    <Button
                        key={option}
                        variant={filter === option ? "default" : "outline"}
                        size="sm"
                        onClick={() => changeFilter(option)}
                    >
                        {option === "ALL" ? "All" : `Unread${unreadCount > 0 ? ` (${unreadCount})` : ""}`}
                    </Button>
                ))}
                <div className="ml-auto flex gap-2">
                    <Button variant="outline" size="sm" onClick={refresh}>
                        Refresh
                    </Button>
                    {unreadCount > 0 && (
                        <Button variant="outline" size="sm" onClick={() => { void markAllRead(); }}>
                            Mark all read
                        </Button>
                    )}
                </div>
            </div>

            {isLoading && <p className="text-sm text-gray-500">Loading notifications...</p>}

            {!isLoading && items.length === 0 && (
                <Card>
                    <CardContent className="p-8 text-center text-gray-500">
                        {filter === "UNREAD"
                            ? "No unread notifications — you're all caught up."
                            : "Nothing here yet. Whenever an audit, email, open or reply happens, it shows up here."}
                    </CardContent>
                </Card>
            )}

            {!isLoading && items.length > 0 && (
                <div className="flex flex-col gap-2">
                    {items.map(notification => (
                        <Card
                            key={notification.id}
                            className={cn(
                                "transition-colors",
                                !notification.read && "border-l-4 border-l-blue-500 bg-blue-50/40"
                            )}
                        >
                            <CardContent className="flex items-start gap-3 p-3">
                                <span aria-hidden className="mt-0.5 text-lg leading-none">
                                    {iconFor(notification.type)}
                                </span>
                                <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                        <span className={cn(
                                            "text-sm",
                                            notification.read ? "text-slate-700" : "font-semibold text-slate-900"
                                        )}>
                                            {notification.title}
                                        </span>
                                        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-gray-600">
                                            {labelFor(notification.type)}
                                        </span>
                                        <span className="text-[11px] text-muted-foreground">
                                            {formatRelativeTime(notification.createdAt)}
                                        </span>
                                    </div>
                                    {notification.body && (
                                        <p className="mt-1 text-xs text-gray-600">{notification.body}</p>
                                    )}
                                    <div className="mt-1.5 flex items-center gap-3">
                                        {notification.href && (
                                            <a
                                                href={notification.href}
                                                onClick={() => { void markRead(notification); }}
                                                className="text-xs font-medium text-primary hover:underline"
                                            >
                                                Open
                                            </a>
                                        )}
                                        {!notification.read && (
                                            <button
                                                type="button"
                                                onClick={() => { void markRead(notification); }}
                                                className="text-xs text-muted-foreground hover:text-foreground hover:underline"
                                            >
                                                Mark as read
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            )}
        </div>
    );
}
