"use client";

import { useState, useEffect, useRef } from "react";
import { OpportunityScore } from "@/types";
import {
    EnrichedProspect,
    PipelineFilter,
    getCachedList,
    getLastActiveFilter,
    hasCachedList,
    setCachedList,
    setLastActiveFilter,
} from "./pipelineCache";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Trash2 } from "lucide-react";
import { logger } from "@/lib/logger";
import Link from "next/link";

import { getErrorMessage } from "@/lib/errors";
import { useToast } from "@/components/ui/toast";
const STATUS_FILTERS: PipelineFilter[] = [
    "DUE", "ALL", "EMAILED", "NEW", "READY_TO_CONTACT", "CONTACTED", "FOLLOW_UP", "QUALIFIED", "UNQUALIFIED"
];

// Human label per outreach sequence state, shown on pipeline cards so the
// list answers "whom have I emailed and where are they in the sequence?".
const OUTREACH_STATE_LABELS: Record<string, string> = {
    UNCONTACTED: "",
    INITIAL_SENT: "Email sent",
    FOLLOW_UP_1_SENT: "Follow-up 1 sent",
    FOLLOW_UP_2_SENT: "Follow-up 2 sent",
    FOLLOW_UP_3_SENT: "Follow-up 3 sent",
    CLOSE_LOOP_SENT: "Close-loop sent",
    COMPLETED: "Sequence completed",
    REPLIED: "Replied",
    BOUNCED: "Bounced",
    UNSUBSCRIBED: "Unsubscribed",
    STOPPED: "Stopped",
};

const getOppColor = (score: OpportunityScore | null | undefined) => {
    if (!score) return "text-gray-300";
    if (score.level === 'VERY_HIGH') return "text-red-600";
    if (score.level === 'HIGH') return "text-orange-600";
    if (score.level === 'MEDIUM') return "text-yellow-600";
    return "text-gray-400";
};

export default function PipelineClient() {
    const toast = useToast();
    // Hydrate directly from the in-memory cache on mount: coming back from a
    // prospect detail paints the previous list instantly, no spinner. A full
    // browser refresh clears the cache — that is the "fresh list" path.
    const [prospects, setProspects] = useState<EnrichedProspect[]>(
        () => getCachedList(getLastActiveFilter()) ?? []
    );
    const [isLoading, setIsLoading] = useState<boolean>(() => !hasCachedList(getLastActiveFilter()));
    const [activeFilter, setActiveFilter] = useState<PipelineFilter>(getLastActiveFilter());
    const latestRequestId = useRef(0);

    useEffect(() => {
        setLastActiveFilter(activeFilter);
        const cacheKey = activeFilter;
        const hadCacheOnScreen = hasCachedList(cacheKey);

        // Revalidate in the background so the painted list becomes truthful
        // (e.g. the audit just opened flips from "New" to viewed). The screen
        // is already populated from the in-memory cache on mount, so this
        // fetch never causes a spinner; a failure stays quiet while a cached
        // list the user can still read is already on screen.
        const requestId = ++latestRequestId.current;
        const fetchProspects = async () => {
            try {
                const query = activeFilter !== "ALL" && activeFilter !== "DUE" ? `?status=${activeFilter}` : "";
                const response = await fetch(`/api/prospects${query}`);
                if (!response.ok) throw new Error("Failed to fetch pipeline");

                const data = await response.json();
                if (requestId !== latestRequestId.current) return; // a newer filter already won
                setProspects(data.prospects);
                setCachedList(cacheKey, data.prospects);
            } catch (err) {
                logger.error("[PipelineClient] Fetch failed:", getErrorMessage(err));
                if (!hadCacheOnScreen) {
                    toast.error("Could not load pipeline", getErrorMessage(err));
                }
            } finally {
                if (requestId === latestRequestId.current) {
                    setIsLoading(false);
                }
            }
        };

        fetchProspects();
    }, [activeFilter, toast]);

    // Filter switches hydrate from the cache instantly; only a filter that
    // was never loaded shows the spinner.
    const applyFilter = (filter: PipelineFilter) => {
        setActiveFilter(filter);
        const cached = getCachedList(filter);
        setIsLoading(!cached);
        if (cached) setProspects(cached);
    };

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

    const handleDelete = async (prospect: EnrichedProspect) => {
        if (!window.confirm(`Delete "${prospect.businessName}" from the pipeline? This also removes its audit and business record.`)) return;
        try {
            const response = await fetch(`/api/prospects/${prospect.id}`, { method: "DELETE" });
            if (!response.ok) {
                const data = await response.json().catch(() => ({ error: "Delete failed" }));
                throw new Error(data.error || "Delete failed");
            }
            const next = prospects.filter(p => p.id !== prospect.id);
            setProspects(next);
            setCachedList(activeFilter, next);
            toast.success(`${prospect.businessName} removed from pipeline`);
        } catch (err: unknown) {
            const message = err instanceof Error ? getErrorMessage(err) : String(err);
            toast.error("Delete failed", message);
            logger.error("[PipelineClient] Delete failed:", message);
        }
    };

    const displayedProspects = activeFilter === "DUE"
        ? prospects.filter(p => {
            const status = getFollowUpStatus(p.nextFollowUpAt);
            return (status === "OVERDUE" || status === "DUE_TODAY") &&
                !["UNQUALIFIED", "CLOSED_LOST", "CONVERTED"].includes(p.pipelineStatus);
        })
        : activeFilter === "EMAILED"
        ? prospects
            .filter(p => p.lastContactedAt !== null || p.outreachState !== "UNCONTACTED")
            .sort((a, b) =>
                new Date(b.lastContactedAt ?? 0).getTime() - new Date(a.lastContactedAt ?? 0).getTime()
            )
        : prospects;

    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap gap-2">
                {STATUS_FILTERS.map(status => (
                    <Button
                        key={status}
                        variant={activeFilter === status ? "default" : "outline"}
                        size="sm"
                        onClick={() => applyFilter(status)}
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
                                : activeFilter === "EMAILED"
                                ? "No emails sent yet. Open a prospect in the pipeline and send the initial outreach email."
                                : "No prospects found in this stage. Discover businesses and add them to your pipeline!"}
                        </CardContent>
                    </Card>
                )}

                {displayedProspects.map((p) => {
                    const followUpStatus = getFollowUpStatus(p.nextFollowUpAt);
                    const isUnread = !p.viewAddedAt;
                    const hasAudit = p.auditScore !== null;
                    const wasEmailed = p.lastContactedAt !== null || p.outreachState !== "UNCONTACTED";
                    const outreachLabel = OUTREACH_STATE_LABELS[p.outreachState] ?? p.outreachState.replace(/_/g, " ").toLowerCase();

                    return (
                        <Link href={`/dashboard/pipeline/${p.id}`} key={p.id} className="block">
                            <Card className={`hover:shadow-md transition-shadow cursor-pointer mb-3 ${isUnread ? 'border-l-4 border-l-blue-500 bg-blue-50/30' : ''}`}>
                            <CardContent className="p-4 flex justify-between items-center gap-3">
                                <div className="flex min-w-0 flex-col">
                                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium uppercase tracking-wide ${
                                            hasAudit ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                                        }`}>
                                            {hasAudit ? '✓ Audit ran' : 'No audit yet'}
                                        </span>
                                        {isUnread && (
                                            <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium uppercase tracking-wide">New</span>
                                        )}
                                        {p.readByAutomation && (
                                            <span
                                                title="The automation wrote and sent this audit email, so it is already marked read"
                                                className="text-[10px] px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded font-medium uppercase tracking-wide"
                                            >
                                                AI sent
                                            </span>
                                        )}
                                    </div>
                                    <span className="text-xs text-gray-500 mt-1">
                                        Status: <span className="font-medium text-slate-700">{p.pipelineStatus.replace(/_/g, " ")}</span>
                                    </span>
                                    {wasEmailed && (
                                        <span className="text-xs text-gray-500 mt-0.5 flex items-center gap-1.5 flex-wrap">
                                            <span>
                                                Last email: <span className="font-medium text-slate-700">{p.lastContactedAt ? new Date(p.lastContactedAt).toLocaleDateString() : "—"}</span>
                                            </span>
                                            {outreachLabel && (
                                                <span className="text-[10px] px-1.5 py-0.5 bg-sky-100 text-sky-700 rounded font-medium uppercase tracking-wide">
                                                    {outreachLabel}
                                                </span>
                                            )}
                                        </span>
                                    )}
                                </div>

                                <div className="flex items-center gap-3 sm:gap-6">
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

                                    {/* Delete */}
                                    <button
                                        type="button"
                                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleDelete(p); }}
                                        className="rounded-md p-1.5 text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors"
                                        title="Delete prospect"
                                        aria-label={`Delete ${p.businessName}`}
                                    >
                                        <Trash2 className="h-4 w-4" />
                                    </button>
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
