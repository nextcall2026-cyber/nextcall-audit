import PipelineClient from "@/components/pipeline/PipelineClient";

export default function PipelinePage() {
    return (
        <div className="flex flex-1 flex-col gap-4 p-4 sm:px-6 sm:py-6">
            <h1 className="text-lg font-semibold">Sales Pipeline</h1>
            <PipelineClient />
        </div>
    );
}