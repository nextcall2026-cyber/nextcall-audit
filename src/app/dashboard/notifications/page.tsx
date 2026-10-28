import NotificationsClient from "@/components/notifications/NotificationsClient";

export default function NotificationsPage() {
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
                <h1 className="text-lg font-semibold">Notifications</h1>
                <p className="text-sm text-muted-foreground">
                    Everything that happened while you were away — new prospects, audits, emails sent,
                    opens, replies and problems worth knowing about.
                </p>
            </div>
            <NotificationsClient />
        </div>
    );
}
