import NotificationsClient from "@/components/notifications/NotificationsClient";
import NotificationSettingsCard from "@/components/notifications/NotificationSettingsCard";
import { ConsoleHeader } from "@/components/console/ConsoleUI";

export default function NotificationsPage() {
    return (
        <div className="flex flex-col gap-5">
            <ConsoleHeader
                eyebrow="NextCall outreach machine // event feed"
                title="NOTIFICATIONS"
                meta="New prospects, audits, emails sent, opens, replies and problems — the machine's own event log."
            />

            <NotificationsClient />

            <NotificationSettingsCard />
        </div>
    );
}
