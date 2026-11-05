"use client";

import { useSyncExternalStore, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoutButton } from "@/components/dashboard/LogoutButton";
import { NotificationBell } from "@/components/notifications/NotificationBell";
import { ToastProvider } from "@/components/ui/toast";
import { AutomationHeartbeat } from "@/components/dashboard/AutomationHeartbeat";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Compass, Kanban, Settings, Camera, Menu, PanelLeft, Bell } from "lucide-react";

const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/dashboard/discovery", label: "Business Discovery", icon: Compass },
    { href: "/dashboard/screenshot", label: "From Screenshot", icon: Camera },
    { href: "/dashboard/pipeline", label: "Pipeline", icon: Kanban },
    { href: "/dashboard/notifications", label: "Notifications", icon: Bell },
    { href: "/dashboard/settings", label: "Settings", icon: Settings },
];

/* Desktop sidebar collapse state, persisted in localStorage. Using
 * useSyncExternalStore keeps hydration safe (server renders it expanded)
 * without a setState-in-effect. */
const SIDEBAR_STORAGE_KEY = "nextcall_sidebar_collapsed";
const SIDEBAR_CHANGE_EVENT = "nextcall-sidebar-change";

function subscribeSidebar(callback: () => void) {
    window.addEventListener(SIDEBAR_CHANGE_EVENT, callback);
    window.addEventListener("storage", callback);
    return () => {
        window.removeEventListener(SIDEBAR_CHANGE_EVENT, callback);
        window.removeEventListener("storage", callback);
    };
}

function getSidebarCollapsed(): boolean {
    try {
        return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

function toggleSidebarCollapsed() {
    try {
        const next = window.localStorage.getItem(SIDEBAR_STORAGE_KEY) !== "1";
        window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next ? "1" : "0");
        window.dispatchEvent(new Event(SIDEBAR_CHANGE_EVENT));
    } catch {
        // storage unavailable — collapse simply won't persist
    }
}

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
    const pathname = usePathname() ?? "";

    return (
        <nav className="flex flex-col gap-4 p-4">
            <Link href="/dashboard" className="mb-4 flex items-center gap-2 text-sm font-semibold tracking-[0.14em] text-foreground">
                <span className="flex h-7 w-7 items-center justify-center rounded-none border border-[#2b3948] bg-[#10171e] text-[10px] font-bold tracking-widest text-[#f5a524]">NC</span>
                NEXTCALL // CONSOLE
            </Link>
            <div className="flex flex-col gap-0.5">
                {navItems.map((item) => {
                    const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
                    const Icon = item.icon;
                    return (
                        <Link
                            key={item.href}
                            href={item.href}
                            onClick={onNavigate}
                            aria-current={isActive ? "page" : undefined}
                            className={cn(
                                "flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                                isActive
                                    ? "bg-primary/10 text-primary"
                                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                            )}
                        >
                            <Icon className="h-4 w-4 shrink-0" />
                            {item.label}
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname() ?? "";
    const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
    const isSidebarCollapsed = useSyncExternalStore(
        subscribeSidebar,
        getSidebarCollapsed,
        () => false
    );

    const pageTitle = navItems.find((item) =>
        item.href === "/dashboard"
            ? pathname === "/dashboard"
            : pathname.startsWith(item.href)
    )?.label || "Dashboard";

    return (
        <ToastProvider>
        <AutomationHeartbeat />
        <div className="flex min-h-screen w-full flex-col mc-scope">
            {/* Desktop sidebar (sm and up) — collapsible */}
            {!isSidebarCollapsed && (
                <aside className="fixed inset-y-0 left-0 z-10 hidden w-64 flex-col border-r bg-sidebar sm:flex">
                    <SidebarNav />
                </aside>
            )}

            {/* Mobile navigation drawer (below sm) */}
            {isMobileNavOpen && (
                <div className="fixed inset-0 z-40 sm:hidden" role="dialog" aria-modal="true" aria-label="Navigation">
                    <button
                        type="button"
                        aria-label="Close navigation menu"
                        onClick={() => setIsMobileNavOpen(false)}
                        className="absolute inset-0 h-full w-full cursor-default bg-black/40"
                    />
                    <aside className="absolute inset-y-0 left-0 w-64 max-w-[85vw] border-r bg-sidebar shadow-xl">
                        <SidebarNav onNavigate={() => setIsMobileNavOpen(false)} />
                    </aside>
                </div>
            )}

            <div className={cn("flex min-w-0 flex-col transition-[padding] duration-200", isSidebarCollapsed ? "sm:pl-0" : "sm:pl-64")}>
                <header className="sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b bg-background px-4 sm:px-6">
                    <div className="flex min-w-0 items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => setIsMobileNavOpen(true)}
                            aria-label="Open navigation menu"
                            aria-expanded={isMobileNavOpen}
                            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:hidden"
                        >
                            <Menu className="h-5 w-5" />
                        </button>
                        <button
                            type="button"
                            onClick={toggleSidebarCollapsed}
                            aria-label={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                            aria-expanded={!isSidebarCollapsed}
                            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
                            className="hidden rounded-md p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:inline-flex"
                        >
                            <PanelLeft className="h-5 w-5" />
                        </button>
                        <h1 className="truncate text-base font-semibold text-foreground">{pageTitle}</h1>
                    </div>
                    <div className="flex items-center gap-1">
                        <NotificationBell />
                        <LogoutButton />
                    </div>
                </header>
                <main className="flex flex-1 flex-col gap-4 p-4 sm:p-6">
                    {children}
                </main>
            </div>
        </div>
        </ToastProvider>
    );
}
