import DiscoveryClient from "@/components/discovery/DiscoveryClient";
import { ConsoleHeader } from "@/components/console/ConsoleUI";

export default function DiscoveryPage() {
    return (
        <div className="flex flex-1 flex-col gap-4">
            <ConsoleHeader
                eyebrow="NextCall outreach machine // discovery"
                title="BUSINESS DISCOVERY"
                meta="Feed the intake line with new local businesses."
            />
            <DiscoveryClient />
        </div>
    );
}