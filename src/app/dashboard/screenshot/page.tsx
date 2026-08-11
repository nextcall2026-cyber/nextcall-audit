import ScreenshotClient from "@/components/screenshot/ScreenshotClient";

export default function ScreenshotPage() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 sm:px-6 sm:py-6">
            <h1 className="text-lg font-semibold">Create from Screenshot</h1>
            <ScreenshotClient />
        </div>
    );
}