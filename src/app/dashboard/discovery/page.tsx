import DiscoveryClient from "@/components/discovery/DiscoveryClient";

export default function DiscoveryPage() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 sm:px-6 sm:py-6">
            <h1 className="text-lg font-semibold">Business Discovery</h1>
            <DiscoveryClient />
        </div>
    );
}