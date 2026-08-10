"use client";

import { useState, useEffect } from "react";
import { Prospect, PipelineStatus, OpportunityScore } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { logger } from "@/lib/logger";
import Link from "next/link";

interface EnrichedProspect extends Prospect {
    businessName: string;
    auditScore: number | null;
}

const STATUS_FILTERS: ("DUE" | PipelineStatus | "ALL")[] = [
    "DUE", "ALL", "NEW", "READY_TO_CONTACT", "CONTACTED", "FOLLOW_UP", "QUALIFIED", "UNQUALIFIED"
];

const getOppColor = (score: OpportunityScore | null | undefined) => {
    if (!score) return "text-gray-300";
    if (score.level === 'VERY_HIGH') return "text-red-600";
    if (score.level === 'HIGH') return "text-orange-600";
    if (score.level === 'MEDIUM') return "text-yellow-600";
    return "text-gray-400";
};

export default function PipelineClient() {
    const [prospects, setProspects] = useState<EnrichedProspect[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [activeFilter, setActiveFilter] = useState<"DUE" | PipelineStatus | "ALL">("ALL");

    useEffect(() => {
        const fetchProspects = async () => {
            setIsLoading(true);
            try {
                const query = activeFilter !== "ALL" && activeFilter !== "DUE" ? `?status=${activeFilter}` : "";
                const response = await fetch(`/api/prospects${query}`);
                if (!response.ok) throw new Error("Failed to fetch pipeline");

                const data = await response.json();
                setProspects(data.prospects);
            } catch (err: any) {
                logger.error("[PipelineClient] Fetch failed:", err.message);
            } finally {
                setIsLoading(false);
            }
        };

        fetchProspects();
    }, [activeFilter]);

    const getScoreColor = (score: number | null) => {
        if (score === null) return "text-gray-400";
        if (score >= 75) return "text-green-600";
        if (score >= 50) return "text-yellow-600";
        return "text-red-600";
    };

    const getFollowUpStatus = (dateStr: string | null): "OVERDUE" | "DUE_TODAY" | "UPCOMING" | "NONE" => {
        if (!dateStr) return "NONE";
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const followUpDate = new Date(dateStr);
        followUpDate.setHours(0, 0, 0, 0);
        if (followUpDate < today) return "OVERDUE";
        if (followUpDate.getTime() === today.getTime()) return "DUE_TODAY";
        return "UPCOMING";
    };

    const displayedProspects = activeFilter === "DUE"
        ? prospects.filter(p => {
            const status = getFollowUpStatus(p.nextFollowUpAt);
            return (status === "OVERDUE" || status === "DUE_TODAY") &&
                !["UNQUALIFIED", "CLOSED_LOST", "CONVERTED"].includes(p.pipelineStatus);
        })
        : prospects;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map(status => (
                    <Button
                        key={status}
                        variant={activeFilter === status ? "default" : "outline"}
                        size="sm"
                        onClick={() => setActiveFilter(status)}
                        className={status === "DUE" && activeFilter !== "DUE" ? "border-red-500 text-red-600 hover:bg-red-50" : ""}
                    >
                        {status.replace(/_/g, " ")}
                    </Button>
                ))}
            </div>

            <div className="flex flex-col gap-3">
                {isLoading && <p className="text-sm text-gray-500">Loading pipeline...</p>}

                {!isLoading && displayedProspects.length === 0 && (
                    <Card>
                        <CardContent className="p-8 text-center text-gray-500">
                            {activeFilter === "DUE"
                                ? "No follow-ups due! You're all caught up."
                                : "No prospects found in this stage. Discover businesses and add them to your pipeline!"}
                        </CardContent>
                    </Card>
                )}

                {displayedProspects.map((p) => {
                    const followUpStatus = getFollowUpStatus(p.nextFollowUpAt);
                    const isUnread = !p.viewAddedAt;

                    return (
                        <Link href={`/dashboard/pipeline/${p.id}`} key={p.id}>
                            <Card className={`hover:shadow-md transition-shadow cursor-pointer mb-3 ${isUnread ? 'border-l-4 border-l-blue-500 bg-blue-50/30' : ''}`}>
                                <CardContent className="p-4 flex justify-between items-center">
                                    <div className="flex flex-col">
                                        <div className="flex items-center gap-2">
                                            <span className={`font-medium ${isUnread ? 'text-slate-900 font-bold' : 'text-slate-700'}`}>
                                                {isUnread && <span className="text-blue-500 mr-1">●</span>}
                                                {p.businessName}
                                            </span>
                                            {p.priorityLevel && (
                                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                                    p.priorityLevel === 'HOT' ? 'bg-red-100 text-red-700' :
                                                    p.priorityLevel === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                                    p.priorityLevel === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                                                    'bg-gray-100 text-gray-700'
                                                }`}>
                                                    {p.priorityLevel}
                                                </span>
                                            )}
                                            {isUnread && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium uppercase tracking-wide">New</span>
                                            )}
                                        </div>
                                        <span className="text-xs text-gray-500 mt-1">
                                            Status: <span className="font-medium text-slate-700">{p.pipelineStatus.replace(/_/g, " ")}</span>
                                        </span>
                                    </div>

                                    <div className="flex items-center gap-6">
                                        {/* Opportunity Score */}
                                        {p.opportunityScore && (
                                            <div className="text-right hidden sm:block">
                                                <span className="block text-xs text-gray-500 uppercase tracking-wide">Opportunity</span>
                                                <span className={`text-sm font-bold ${getOppColor(p.opportunityScore)}`}>
                                                    {p.opportunityScore.score}
                                                </span>
                                            </div>
                                        )}

                                        {/* Follow Up Indicator */}
                                        <div className="text-right hidden sm:block">
                                            <span className="block text-xs text-gray-500 uppercase tracking-wide">Next Follow-up</span>
                                            <span className={`text-sm font-medium ${followUpStatus === "OVERDUE" ? "text-red-600" :
                                                    followUpStatus === "DUE_TODAY" ? "text-orange-600" :
                                                        "text-slate-700"
                                                }`}>
                                                {p.nextFollowUpAt ? new Date(p.nextFollowUpAt).toLocaleDateString() : "—"}
                                                {followUpStatus === "OVERDUE" && " (Overdue)"}
                                                {followUpStatus === "DUE_TODAY" && " (Today)"}
                                            </span>
                                        </div>

                                        {/* Audit Score */}
                                        <div className="text-right">
                                            <span className="block text-xs text-gray-500 uppercase tracking-wide">Audit</span>
                                            <span className={`text-lg font-bold ${getScoreColor(p.auditScore)}`}>
                                                {p.auditScore !== null ? p.auditScore : "N/A"}
                                            </span>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>
                        </Link>
                    );
                })}
            </div>
        </div>
    );
}
