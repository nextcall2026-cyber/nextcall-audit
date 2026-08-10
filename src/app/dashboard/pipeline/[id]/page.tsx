import ProspectDetailClient from "@/components/pipeline/ProspectDetailClient";

export default async function ProspectDetailPage({ params }: { params: Promise<{ id: string }> }) {
    const { id } = await params;
    return <ProspectDetailClient prospectId={id} />;
}
