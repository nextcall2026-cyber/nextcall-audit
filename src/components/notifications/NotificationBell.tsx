"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { AppNotification } from "@/types";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import { formatRelativeTime, iconFor } from "@/lib/notificationTypes";

const POLL_INTERVAL_MS = 45_000;
const PREVIEW_LIMIT = 8;

/**
 * Dashboard notification bell: unread badge + recent-event dropdown.
 * Polls the notifications API while the tab is open and refreshes on focus,
 * so "what happened while I was away" is always one click away.
 */
export function NotificationBell() {
    const router = useRouter();
    const [items, setItems] = useState<AppNotification[]>([]);
    const [unreadCount, setUnreadCount] = useState(0);
    const [isOpen, setIsOpen] = useState(false);
    const isMounted = useRef(true);

    useEffect(() => {
        isMounted.current = true;

        // Defined inside the effect so the poller owns its own lifecycle.
        const run = async () => {
            try {
                const res = await fetch(`/api/notifications?limit=${PREVIEW_LIMIT}`);
                if (!res.ok) throw new Error(`Request failed (${res.status})`);
                const data = (await res.json()) as {
                    notifications: AppNotification[];
                    unreadCount: number;
                };
                if (!isMounted.current) return;
                setItems(data.notifications ?? []);
                setUnreadCount(data.unreadCount ?? 0);
            } catch (err) {
                logger.error("[NotificationBell] Fetch failed:", getErrorMessage(err));
            }
        };

        void run();

        const timer = setInterval(() => { void run(); }, POLL_INTERVAL_MS);
        const onFocus = () => { void run(); };
        window.addEventListener("focus", onFocus);

        return () => {
            isMounted.current = false;
            clearInterval(timer);
            window.removeEventListener("focus", onFocus);
        };
    }, []);

    const markReadAndGo = async (notification: AppNotification) => {
        setIsOpen(false);

        if (!notification.read) {
            setItems(prev => prev.map(i => (i.id === notification.id ? { ...i, read: true } : i)));
            setUnreadCount(count => Math.max(0, count - 1));
            try {
                await fetch("/api/notifications", {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ ids: [notification.id] }),
                });
            } catch (err) {
                logger.error("[NotificationBell] Mark read failed:", getErrorMessage(err));
            }
        }

        if (notification.href) router.push(notification.href);
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
            logger.error("[NotificationBell] Mark all read failed:", getErrorMessage(err));
        }
    };

    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => setIsOpen(open => !open)}
                aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : "Notifications"}
                aria-expanded={isOpen}
                className="relative rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            >
                <Bell className="h-5 w-5" />
                {unreadCount > 0 && (
                    <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                        {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                )}
            </button>

            {isOpen && (
                <>
                    <button
                        type="button"
                        aria-label="Close notifications"
                        onClick={() => setIsOpen(false)}
                        className="fixed inset-0 z-40 cursor-default"
                    />
                    <div className="absolute right-0 z-50 mt-2 w-[22rem] max-w-[90vw] overflow-hidden rounded-lg border bg-background shadow-lg">
                        <div className="flex items-center justify-between border-b px-3 py-2">
                            <span className="text-sm font-semibold">Notifications</span>
                            {unreadCount > 0 && (
                                <button
                                    type="button"
                                    onClick={markAllRead}
                                    className="text-xs font-medium text-primary hover:underline"
                                >
                                    Mark all read
                                </button>
                            )}
                        </div>

                        <div className="max-h-96 overflow-y-auto">
                            {items.length === 0 && (
                                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                                    Nothing yet. Audits, emails and replies will show up here.
                                </p>
                            )}

                            {items.map(notification => (
                                <button
                                    key={notification.id}
                                    type="button"
                                    onClick={() => { void markReadAndGo(notification); }}
                                    className={cn(
                                        "flex w-full items-start gap-3 border-b px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-accent",
                                        !notification.read && "bg-blue-50/60"
                                    )}
                                >
                                    <span aria-hidden className="mt-0.5 text-base leading-none">
                                        {iconFor(notification.type)}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className={cn(
                                            "block truncate text-sm",
                                            notification.read ? "text-slate-700" : "font-semibold text-slate-900"
                                        )}>
                                            {notification.title}
                                        </span>
                                        {notification.body && (
                                            <span className="mt-0.5 block line-clamp-2 text-xs text-muted-foreground">
                                                {notification.body}
                                            </span>
                                        )}
                                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                                            {formatRelativeTime(notification.createdAt)}
                                        </span>
                                    </span>
                                    {!notification.read && (
                                        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-500" aria-hidden />
                                    )}
                                </button>
                            ))}
                        </div>

                        <Link
                            href="/dashboard/notifications"
                            onClick={() => setIsOpen(false)}
                            className="block border-t px-3 py-2 text-center text-xs font-medium text-primary hover:bg-accent"
                        >
                            View all notifications
                        </Link>
                    </div>
                </>
            )}
        </div>
    );
}
