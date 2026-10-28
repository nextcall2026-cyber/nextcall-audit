import NotificationsClient from "@/components/notifications/NotificationsClient";
import NotificationSettingsCard from "@/components/notifications/NotificationSettingsCard";
import AutoSendSettingsCard from "@/components/notifications/AutoSendSettingsCard";

export default function NotificationsPage() {
    return (
        <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-1">
                <h1 className="text-lg font-semibold">Notifications</h1>
                <p className="text-sm text-muted-foreground">
                    Everything that happened while you were away — new prospects, audits, emails sent,
                    opens, replies and problems worth knowing about.
                </p>
            </div>

            <NotificationsClient />

            <div className="grid gap-6 lg:grid-cols-2">
                <AutoSendSettingsCard />
                <NotificationSettingsCard />
            </div>
        </div>
    );
}
