import PipelineClient from "@/components/pipeline/PipelineClient";
import { ConsoleHeader } from "@/components/console/ConsoleUI";

export default function PipelinePage() {
    return (
        <div className="flex flex-1 flex-col gap-4">
            <ConsoleHeader
                eyebrow="NextCall outreach machine // pipeline"
                title="SALES PIPELINE"
                meta="Every audited business lands here, scored and ready to contact."
            />
            <PipelineClient />
        </div>
    );
}