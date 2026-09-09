"use client";

import { useState, useEffect, useCallback } from "react";
import { Business, AuditResult, AuditReport, Prospect, OutreachRecord, PipelineStatus, FollowUpDraft, OutreachSequenceState, OpportunityScore } from "@/types";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { logger } from "@/lib/logger";
import { normalizeExternalUrl, isValidExternalUrl } from "@/lib/externalUrl";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";

import { getErrorMessage } from "@/lib/errors";
interface ProspectDetailData {
    prospect: Prospect;
    business: Business;
    audit: AuditResult | null;
    aiReport: AuditReport | null;
    outreachHistory: OutreachRecord[];
}

const PIPELINE_STATUSES: PipelineStatus[] = [
    "NEW", "READY_TO_CONTACT", "CONTACTED", "FOLLOW_UP", "QUALIFIED", "UNQUALIFIED", "CONVERTED", "CLOSED_LOST"
];

// Base UI Select only shows item labels in the trigger when `items` is
// provided — otherwise the raw enum value is displayed.
const PIPELINE_STATUS_ITEMS = PIPELINE_STATUSES.map((status) => ({
    value: status,
    label: status.replace(/_/g, " "),
}));

const STOP_PIPELINE_STATUSES: PipelineStatus[] = ["QUALIFIED", "UNQUALIFIED", "CLOSED_LOST"];
const STOP_OUTREACH_STATES: OutreachSequenceState[] = ["CLOSE_LOOP_SENT", "COMPLETED", "REPLIED", "BOUNCED", "UNSUBSCRIBED", "STOPPED"];

export default function ProspectDetailClient({ prospectId }: { prospectId: string }) {
    const [data, setData] = useState<ProspectDetailData | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [noteText, setNoteText] = useState("");
    const [emailInput, setEmailInput] = useState("");
    const [isSavingEmail, setIsSavingEmail] = useState(false);

    const [draft, setDraft] = useState<FollowUpDraft | null>(null);
    const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
    const [isSendingFollowUp, setIsSendingFollowUp] = useState(false);
    const [isSendingInitial, setIsSendingInitial] = useState(false);
    const [isRunningAudit, setIsRunningAudit] = useState(false);
    const [actionError, setActionError] = useState<string | null>(null);

    // Pure fetch without setState, so the mount effect can call it without
    // triggering react-hooks/set-state-in-effect (state updates happen in
    // promise continuations instead).
    const loadDetails = useCallback(async (): Promise<ProspectDetailData> => {
        const res = await fetch(`/api/prospects/${prospectId}`);
        if (!res.ok) {
            const errData = await res.json().catch(() => ({ error: "Unknown error" }));
            throw new Error(errData.error || `Request failed (${res.status})`);
        }
        return (await res.json()) as ProspectDetailData;
    }, [prospectId]);

    // Used by event handlers to refresh after a mutation
    const fetchDetails = useCallback(async () => {
        setIsLoading(true);
        setActionError(null);
        try {
            const result = await loadDetails();
            setData(result);
            setEmailInput(result.prospect.contactEmail || "");
        } catch (err) {
            logger.error("[ProspectDetail] Fetch failed:", getErrorMessage(err));
            setActionError(getErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    }, [loadDetails]);

    useEffect(() => {
        loadDetails()
            .then((result) => {
                setData(result);
                setEmailInput(result.prospect.contactEmail || "");
            })
            .catch((err: unknown) => {
                logger.error("[ProspectDetail] Fetch failed:", getErrorMessage(err));
                setActionError(getErrorMessage(err));
            })
            .finally(() => {
                setIsLoading(false);
            });
    }, [loadDetails]);

    // Mark as viewed once, after the details first load. The PATCH returns
    // the updated prospect, so no separate local state patch is needed.
    useEffect(() => {
        if (!data || isLoading) return;
        if (data.prospect.viewAddedAt) return; // Already viewed
        fetch(`/api/prospects/${prospectId}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
        })
            .then((res) => (res.ok ? res.json() : null))
            .then((updated: { prospect: Prospect } | null) => {
                if (!updated?.prospect) return;
                setData(prev => prev ? { ...prev, prospect: updated.prospect } : prev);
            })
            .catch(() => { /* ignore */ });
    }, [data, isLoading, prospectId]);

    const handleStatusChange = async (newStatus: PipelineStatus) => {
        if (!data) return;
        try {
            await fetch(`/api/prospects/${prospectId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ status: newStatus }),
            });
            setData({ ...data, prospect: { ...data.prospect, pipelineStatus: newStatus } });
        } catch (err) {
            logger.error("[ProspectDetail] Status update failed:", getErrorMessage(err));
        }
    };

    const handleAddNote = async () => {
        if (!noteText.trim() || !data) return;
        try {
            const res = await fetch(`/api/prospects/${prospectId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ noteText }),
            });
            if (!res.ok) throw new Error("Failed to save note");
            const updatedProspect = (await res.json()).prospect;
            setData({ ...data, prospect: updatedProspect });
            setNoteText("");
        } catch (err) {
            logger.error("[ProspectDetail] Add note failed:", getErrorMessage(err));
        }
    };

    const handleSuppress = async () => {
        if (!data) return;
        const reason = prompt("Enter suppression reason (e.g., REPLIED, UNSUBSCRIBED, DO_NOT_CONTACT):", "MANUAL_DNC");
        if (reason === null) return;

        try {
            await fetch(`/api/prospects/${prospectId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ isSuppressed: true, suppressionReason: reason || "MANUAL_DNC" }),
            });
            await fetchDetails();
        } catch (err) {
            logger.error("[ProspectDetail] Suppress failed:", getErrorMessage(err));
        }
    };

    const handleGenerateDraft = async () => {
        setIsGeneratingDraft(true);
        setActionError(null);
        try {
            const res = await fetch("/api/outreach/followup-draft", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prospectId }),
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed to generate draft");
            }
            const data = await res.json();
            setDraft(data.draft);
        } catch (err) {
            setActionError(getErrorMessage(err));
            logger.error("[ProspectDetail] Draft generation failed:", getErrorMessage(err));
        } finally {
            setIsGeneratingDraft(false);
        }
    };

    const handleSendFollowUp = async () => {
        if (!draft) return;
        setIsSendingFollowUp(true);
        setActionError(null);
        try {
            const res = await fetch("/api/outreach/send-followup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    prospectId,
                    subject: draft.subject,
                    body: draft.body,
                    stage: draft.stage,
                    ctaType: draft.ctaType,
                    angle: draft.angle
                }),
            });

            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed to send follow-up");
            }

            setDraft(null);
            await fetchDetails();
        } catch (err) {
            setActionError(getErrorMessage(err));
            logger.error("[ProspectDetail] Send follow-up failed:", getErrorMessage(err));
        } finally {
            setIsSendingFollowUp(false);
        }
    };

    const handleSendInitial = async () => {
        setIsSendingInitial(true);
        setActionError(null);
        try {
            // If the user typed an email, save it first so outreach sends to it
            if (typedEmailValid && typedEmail !== (data?.prospect.contactEmail || "")) {
                const saveRes = await fetch(`/api/prospects/${prospectId}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ contactEmail: typedEmail }),
                });
                if (saveRes.ok) {
                    const updatedProspect = (await saveRes.json()).prospect;
                    setData(prev => prev ? { ...prev, prospect: updatedProspect } : prev);
                }
            }
            const res = await fetch("/api/outreach", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ prospectId }),
            });
            if (!res.ok) {
                const errData = await res.json();
                throw new Error(errData.error || "Failed to send initial email");
            }
            await fetchDetails();
        } catch (err) {
            setActionError(getErrorMessage(err));
            logger.error("[ProspectDetail] Send initial failed:", getErrorMessage(err));
        } finally {
            setIsSendingInitial(false);
        }
    };

    const handleSaveEmail = async () => {
        if (!data) return;
        const email = emailInput.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            setActionError("Please enter a valid email address.");
            return;
        }
        setIsSavingEmail(true);
        setActionError(null);
        try {
            const res = await fetch(`/api/prospects/${prospectId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ contactEmail: email }),
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ error: "Failed to save email" }));
                throw new Error(errData.error || "Failed to save email");
            }
            const updatedProspect = (await res.json()).prospect;
            setData({ ...data, prospect: updatedProspect });
        } catch (err) {
            setActionError(getErrorMessage(err));
            logger.error("[ProspectDetail] Save email failed:", getErrorMessage(err));
        } finally {
            setIsSavingEmail(false);
        }
    };

    const handleRunAudit = async () => {
        if (!data) return;
        setIsRunningAudit(true);
        setActionError(null);
        try {
            const res = await fetch("/api/audit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ businessId: data.prospect.businessId, business: data.business }),
            });
            if (!res.ok) {
                const errData = await res.json().catch(() => ({ error: "Failed to run audit" }));
                throw new Error(errData.error || "Failed to run audit");
            }
            const result = await res.json();
            if (!result.aiReport) {
                throw new Error("AI report generation failed. Check the AI provider configuration.");
            }
            await fetchDetails();
        } catch (err) {
            setActionError(getErrorMessage(err));
            logger.error("[ProspectDetail] Run audit failed:", getErrorMessage(err));
        } finally {
            setIsRunningAudit(false);
        }
    };

    if (isLoading) return <div className="p-8 text-center text-gray-500">Loading prospect details...</div>;
    if (!data) return (
        <div className="p-8 text-center">
            <p className="text-red-500 font-medium">Failed to load prospect data.</p>
            {actionError && <p className="text-xs text-gray-500 mt-2">{actionError}</p>}
            <Button size="sm" variant="outline" onClick={fetchDetails} className="mt-4">
                Retry
            </Button>
        </div>
    );

    const { prospect, business, audit, aiReport, outreachHistory } = data;
    const typedEmail = emailInput.trim();
    const typedEmailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(typedEmail);
    const hasUsableEmail = typedEmailValid || !!prospect.contactEmail;
    const hasBeenContacted = prospect.outreachState !== 'UNCONTACTED';
    const isStopStatus = STOP_PIPELINE_STATUSES.includes(prospect.pipelineStatus) || STOP_OUTREACH_STATES.includes(prospect.outreachState) || prospect.isSuppressed;
    const sortedHistory = [...outreachHistory].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
    const isBusinessMissing = !business.name || business.name === "Business data unavailable";
    const oppScore: OpportunityScore | null = prospect.opportunityScore || null;
    const enrichment = business.enrichment;
    const businessWebsite = normalizeExternalUrl(business.website);
    const snapshot = prospect.businessSnapshot;
    const snapshotWebsite = normalizeExternalUrl(snapshot?.website);

    return (
        <div className="flex flex-col gap-6 p-4 sm:px-6 sm:py-6">

            {/* Back Button */}
            <Link href="/dashboard/pipeline" className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline w-fit">
                <ArrowLeft className="h-4 w-4" />
                Back to Pipeline
            </Link>

            {/* Header Section */}
            <div className="flex flex-wrap justify-between items-start gap-4 border-b pb-4">
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">{business.name || "Unknown Business"}</h1>
                    <p className="text-sm text-gray-500 mt-1">
                        {(business.categories?.[0] || snapshot?.categories?.[0]) || "General"} | {business.location?.city || snapshot?.location?.city || "—"}, {business.location?.state || snapshot?.location?.state || ""}
                    </p>
                    {isBusinessMissing && (
                        <p className="text-xs text-yellow-600 mt-2">Business data was removed from the database. Showing cached snapshot.</p>
                    )}
                </div>
                <div className="flex flex-col gap-2 w-48">
                    <label className="text-xs text-gray-500 uppercase tracking-wide">Pipeline Status</label>
                    <Select items={PIPELINE_STATUS_ITEMS} value={prospect.pipelineStatus} onValueChange={(v) => handleStatusChange(v as PipelineStatus)}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                            {PIPELINE_STATUSES.map(status => (
                                <SelectItem key={status} value={status}>{status.replace(/_/g, " ")}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

                {/* Left Column */}
                <div className="lg:col-span-2 flex flex-col gap-6">

                    {/* Lead Opportunity Score Card */}
                    {oppScore && (
                        <Card>
                            <CardHeader><CardTitle className="text-sm">Lead Opportunity Score</CardTitle></CardHeader>
                            <CardContent>
                                <div className="flex items-center gap-4 mb-3">
                                    <div className={`text-3xl font-bold ${
                                        oppScore.level === 'VERY_HIGH' ? 'text-red-600' :
                                        oppScore.level === 'HIGH' ? 'text-orange-600' :
                                        oppScore.level === 'MEDIUM' ? 'text-yellow-600' : 'text-gray-400'
                                    }`}>
                                        {oppScore.score}<span className="text-lg font-normal text-gray-400">/100</span>
                                    </div>
                                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                        oppScore.level === 'VERY_HIGH' ? 'bg-red-100 text-red-800' :
                                        oppScore.level === 'HIGH' ? 'bg-orange-100 text-orange-800' :
                                        oppScore.level === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                                        'bg-gray-100 text-gray-600'
                                    }`}>
                                        {oppScore.level === 'VERY_HIGH' ? 'VERY HIGH' : oppScore.level} OPPORTUNITY
                                    </span>
                                </div>

                                {/* Top Reasons */}
                                {oppScore.reasons.length > 0 && (
                                    <div className="mb-3">
                                        <h4 className="font-semibold text-slate-800 text-xs uppercase mb-1">Why this business needs NextCall</h4>
                                        <ul className="space-y-1 text-xs">
                                            {oppScore.reasons.map((r, i) => (
                                                <li key={i} className="flex items-start gap-1.5">
                                                    <span className="text-green-600 mt-0.5">✓</span>
                                                    <span className="text-gray-700">{r}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Evidence */}
                                {(oppScore.evidence?.length ?? 0) > 0 && (
                                    <div className="mb-3 border-t pt-2">
                                        <h4 className="font-semibold text-slate-800 text-xs uppercase mb-1">Verified Facts</h4>
                                        <ul className="space-y-0.5 text-xs text-gray-600 list-disc list-inside">
                                            {(oppScore.evidence || []).map((e, i) => <li key={i}>{e}</li>)}
                                        </ul>
                                    </div>
                                )}

                                {/* Unknown Factors */}
                                {(oppScore.unknownFactors?.length ?? 0) > 0 && (
                                    <div className="mb-3 border-t pt-2">
                                        <h4 className="font-semibold text-slate-800 text-xs uppercase mb-1">Unknown (more data needed)</h4>
                                        <ul className="space-y-0.5 text-xs text-gray-400">
                                            {(oppScore.unknownFactors || []).map((u, i) => (
                                                <li key={i} className="flex items-start gap-1.5">
                                                    <span className="text-gray-400 mt-0.5">?</span>
                                                    <span>{u}</span>
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {/* Score Breakdown */}
                                {(oppScore.scoreBreakdown?.length ?? 0) > 0 && (
                                    <div className="border-t pt-2">
                                        <h4 className="font-semibold text-slate-800 text-xs uppercase mb-1">Score Breakdown</h4>
                                        <div className="space-y-1">
                                            {(oppScore.scoreBreakdown || []).map((item, i) => (
                                                <div key={i} className="flex justify-between items-center text-xs">
                                                    <span className="text-gray-600 truncate max-w-[200px]">{item.signal}</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-[10px] px-1 py-0.5 rounded ${
                                                            item.status === 'DETECTED' ? 'bg-orange-100 text-orange-700' :
                                                            item.status === 'NOT_DETECTED' ? 'bg-green-100 text-green-700' :
                                                            'bg-gray-100 text-gray-500'
                                                        }`}>
                                                            {item.status === 'DETECTED' ? '+' : ''}{item.points}
                                                        </span>
                                                        <span className="text-gray-400">/ {item.maxPoints}</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                <p className="text-xs text-gray-400 mt-3 italic">Higher score = stronger opportunity for NextCall to provide value</p>
                            </CardContent>
                        </Card>
                    )}

                    {/* Priority Intelligence Card */}
                    {prospect.priorityBreakdown && (
                        <Card>
                            <CardHeader><CardTitle className="text-sm">Priority Intelligence</CardTitle></CardHeader>
                            <CardContent>
                                <div className="flex justify-between items-center mb-4">
                                    <div className="flex flex-col">
                                        <span className="text-4xl font-bold text-blue-600">
                                            {prospect.priorityScore || 0}<span className="text-lg text-gray-400">/100</span>
                                        </span>
                                        <span className="text-xs text-gray-500 uppercase tracking-wide">Overall Priority</span>
                                    </div>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                                            prospect.priorityLevel === 'HOT' ? 'bg-red-100 text-red-700' :
                                            prospect.priorityLevel === 'HIGH' ? 'bg-orange-100 text-orange-700' :
                                            prospect.priorityLevel === 'MEDIUM' ? 'bg-yellow-100 text-yellow-700' :
                                            'bg-gray-100 text-gray-700'
                                        }`}>
                                            {prospect.priorityLevel || 'N/A'}
                                        </span>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                    <div className="bg-slate-50 p-2 rounded">
                                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                                            <span>Contactability</span>
                                            <span className="font-medium text-slate-700">{prospect.priorityBreakdown.contactability}</span>
                                        </div>
                                        <div className="h-1 bg-gray-200 rounded-full">
                                            <div className="h-1 bg-blue-500 rounded-full" style={{ width: `${prospect.priorityBreakdown.contactability}%` }}></div>
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 p-2 rounded">
                                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                                            <span>NextCall Fit</span>
                                            <span className="font-medium text-slate-700">{prospect.priorityBreakdown.nextCallFit}</span>
                                        </div>
                                        <div className="h-1 bg-gray-200 rounded-full">
                                            <div className="h-1 bg-purple-500 rounded-full" style={{ width: `${prospect.priorityBreakdown.nextCallFit}%` }}></div>
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 p-2 rounded">
                                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                                            <span>Maturity</span>
                                            <span className="font-medium text-slate-700">{prospect.priorityBreakdown.businessMaturity}</span>
                                        </div>
                                        <div className="h-1 bg-gray-200 rounded-full">
                                            <div className="h-1 bg-green-500 rounded-full" style={{ width: `${prospect.priorityBreakdown.businessMaturity}%` }}></div>
                                        </div>
                                    </div>
                                    <div className="bg-slate-50 p-2 rounded">
                                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                                            <span>Readiness</span>
                                            <span className="font-medium text-slate-700">{prospect.priorityBreakdown.outreachReadiness}</span>
                                        </div>
                                        <div className="h-1 bg-gray-200 rounded-full">
                                            <div className="h-1 bg-yellow-500 rounded-full" style={{ width: `${prospect.priorityBreakdown.outreachReadiness}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <h4 className="font-semibold text-slate-800 text-xs uppercase mb-2">Why this prospect?</h4>
                                    <ul className="space-y-1 text-xs text-gray-600 list-disc list-inside">
                                        {prospect.priorityBreakdown.reasons.map((reason, i) => (
                                            <li key={i}>{reason}</li>
                                        ))}
                                    </ul>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Business Overview Card */}
                    <Card>
                        <CardHeader><CardTitle className="text-sm">Business Overview</CardTitle></CardHeader>
                        <CardContent className="text-xs space-y-2">
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <span className="text-gray-500">Business Type</span>
                                    <p className="font-medium text-slate-800">{(business.categories?.[0] || snapshot?.categories?.[0]) || "N/A"}</p>
                                </div>
                                <div>
                                    <span className="text-gray-500">Phone</span>
                                    <p className="font-medium text-slate-800">{business.phone || snapshot?.phone || "Not found"}</p>
                                </div>
                                <div>
                                    <span className="text-gray-500">Rating</span>
                                    <p className="font-medium text-slate-800">{business.rating || snapshot?.rating ? `★ ${(business.rating || snapshot?.rating || 0).toFixed(1)}` : "N/A"}</p>
                                </div>
                                <div>
                                    <span className="text-gray-500">Reviews</span>
                                    <p className="font-medium text-slate-800">{business.reviewCount ?? snapshot?.reviewCount ?? "N/A"}</p>
                                </div>
                                <div>
                                    <span className="text-gray-500">Location</span>
                                    <p className="font-medium text-slate-800">{business.location?.address || snapshot?.location?.address || "N/A"}</p>
                                </div>
                                <div>
                                    <span className="text-gray-500">Source Providers</span>
                                    <p className="font-medium text-slate-800">{(business.sourceProviders || snapshot?.sourceProviders || []).join(", ") || "Unknown"}</p>
                                </div>
                            </div>
                        </CardContent>
                    </Card>

                    {/* Website Card */}
                    <Card>
                        <CardHeader><CardTitle className="text-sm">Website</CardTitle></CardHeader>
                        <CardContent className="text-xs space-y-2">
                            {businessWebsite || snapshotWebsite ? (
                                <>
                                    <p className="text-gray-500 break-all font-mono text-xs bg-slate-50 p-2 rounded">
                                        {businessWebsite || snapshotWebsite}
                                    </p>
                                    {isValidExternalUrl(businessWebsite || snapshotWebsite) && (
                                        <a
                                            href={businessWebsite || snapshotWebsite || '#'}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 hover:underline"
                                        >
                                            <ExternalLink className="h-3.5 w-3.5" />
                                            Open Website
                                        </a>
                                    )}
                                </>
                            ) : (
                                <p className="text-gray-400">Not found</p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Contact Information Card */}
                    {enrichment && enrichment.status === "COMPLETED" && (
                        <Card>
                            <CardHeader><CardTitle className="text-sm">Contact Information</CardTitle></CardHeader>
                            <CardContent className="text-xs space-y-3">
                                {enrichment.preferredEmail ? (
                                    <div>
                                        <span className="text-gray-500">Preferred Email</span>
                                        <p className="font-medium text-blue-600">{enrichment.preferredEmail}</p>
                                    </div>
                                ) : <p className="text-gray-400">No preferred email found</p>}

                                <div>
                                    <span className="text-gray-500">All Discovered Emails</span>
                                    {enrichment.emails && enrichment.emails.length > 0 ? (
                                        <ul className="mt-1 space-y-1">
                                            {enrichment.emails.map((e, i) => (
                                                <li key={i} className="bg-slate-50 p-1.5 rounded text-xs">
                                                    <span className="font-medium">{e.address}</span>
                                                    <span className="text-gray-400 ml-2">({e.type}, confidence: {e.confidence}%)</span>
                                                    {e.sourceUrl && <span className="text-gray-400 block truncate">Source: {e.sourceUrl}</span>}
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-gray-400">Not found</p>
                                    )}
                                </div>

                                <div>
                                    <span className="text-gray-500">Phone Numbers</span>
                                    {enrichment.phones && enrichment.phones.length > 0 ? (
                                        <ul className="mt-1 space-y-1">
                                            {enrichment.phones.map((p, i) => (
                                                <li key={i} className="font-medium">
                                                    {p.normalized}
                                                    <span className="text-gray-400 ml-2">(confidence: {p.confidence}%)</span>
                                                </li>
                                            ))}
                                        </ul>
                                    ) : (
                                        <p className="text-gray-400">{business.phone || "Not found"}</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Social Media Card */}
                    {enrichment && enrichment.status === "COMPLETED" && (
                        <Card>
                            <CardHeader><CardTitle className="text-sm">Social Media</CardTitle></CardHeader>
                            <CardContent className="text-xs space-y-2">
                                {enrichment.socialProfiles && enrichment.socialProfiles.length > 0 ? (
                                    <ul className="space-y-1.5">
                                        {enrichment.socialProfiles.map((s, i) => (
                                            <li key={i}>
                                                <span className="font-medium capitalize">{s.platform}</span>
                                                {s.url && (
                                                    <a href={normalizeExternalUrl(s.url) || '#'} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline ml-2 block truncate">
                                                        {s.url}
                                                    </a>
                                                )}
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <p className="text-gray-400">No social media profiles detected</p>
                                )}
                                {(!enrichment.socialProfiles || enrichment.socialProfiles.length === 0) && (
                                    <p className="text-gray-400">Unable to verify social presence</p>
                                )}
                                <div className="text-gray-400 text-[10px] mt-1">
                                    Source: {enrichment.website?.url || 'website crawl'}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Booking & Conversion Card */}
                    {enrichment && enrichment.status === "COMPLETED" && (
                        <Card>
                            <CardHeader><CardTitle className="text-sm">Booking & Conversion</CardTitle></CardHeader>
                            <CardContent className="text-xs space-y-2">
                                {enrichment.booking?.detected ? (
                                    <div>
                                        <p className="text-green-700 font-medium">✓ Booking system detected</p>
                                        {enrichment.booking.systemName && <p>System: {enrichment.booking.systemName}</p>}
                                        {enrichment.booking.url && (
                                            <a href={normalizeExternalUrl(enrichment.booking.url) || '#'} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline block truncate">
                                                {enrichment.booking.url}
                                            </a>
                                        )}
                                    </div>
                                ) : (
                                    <div>
                                        <p className="text-red-700 font-medium">✗ No online booking detected</p>
                                        <p className="text-gray-400 mt-1">NextCall can automate appointment scheduling for this business.</p>
                                    </div>
                                )}

                                <div className="border-t pt-2 mt-2">
                                    <span className="text-gray-500">Website Features</span>
                                    <div className="flex flex-wrap gap-2 mt-1">
                                        {(['hasContactForm', 'hasLiveChat', 'hasClickToCall', 'hasSecureSSL'] as const).map(f => {
                                            const val = enrichment.features?.[f];
                                            return (
                                                <span key={f} className={`px-2 py-0.5 rounded text-xs ${
                                                    val === true ? 'bg-green-50 text-green-700' :
                                                    val === 'UNKNOWN' ? 'bg-gray-100 text-gray-500' :
                                                    'bg-red-50 text-red-700'
                                                }`}>
                                                    {f.replace('has', '').replace(/([A-Z])/g, ' $1').trim()}: {val === true ? 'Yes' : val === 'UNKNOWN' ? 'Unable to verify' : 'No'}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </div>

                                <div className="border-t pt-2">
                                    <span className="text-gray-500">Appointment Scheduling</span>
                                    <p className={enrichment.booking?.detected ? 'text-green-700' : 'text-red-700'}>
                                        {enrichment.booking?.detected ? 'Detected' : 'Not detected'}
                                    </p>
                                    {enrichment.features?.hasContactForm === true && (
                                        <p className="text-green-700">✓ Contact form present</p>
                                    )}
                                    {enrichment.features?.hasContactForm === false && (
                                        <p className="text-orange-700">✗ No contact form — calls are primary path</p>
                                    )}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Pipeline Info Card */}
                    <Card>
                        <CardHeader><CardTitle className="text-sm">Pipeline Info</CardTitle></CardHeader>
                        <CardContent className="text-xs space-y-1.5">
                            <div className="flex justify-between">
                                <span className="text-gray-500">Status</span>
                                <span className="font-medium">{prospect.pipelineStatus.replace(/_/g, " ")}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Viewed</span>
                                <span className="font-medium">{prospect.viewAddedAt ? `✓ Viewed (${new Date(prospect.viewAddedAt).toLocaleDateString()})` : '● Unviewed'}</span>
                            </div>
                            {prospect.viewedCount !== undefined && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Times Viewed</span>
                                    <span className="font-medium">{prospect.viewedCount}</span>
                                </div>
                            )}
                            <div className="flex justify-between">
                                <span className="text-gray-500">Contacted</span>
                                <span className="font-medium">{prospect.lastContactedAt ? `Yes (${new Date(prospect.lastContactedAt).toLocaleDateString()})` : 'No'}</span>
                            </div>
                            <div className="flex justify-between">
                                <span className="text-gray-500">Created</span>
                                <span className="font-medium">{new Date(prospect.createdAt).toLocaleDateString()}</span>
                            </div>
                            {prospect.nextFollowUpAt && (
                                <div className="flex justify-between">
                                    <span className="text-gray-500">Next Follow-up</span>
                                    <span className="font-medium">{new Date(prospect.nextFollowUpAt).toLocaleDateString()}</span>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {/* Source Providers Card */}
                    <Card>
                        <CardHeader><CardTitle className="text-sm">Source Providers</CardTitle></CardHeader>
                        <CardContent className="text-xs space-y-1">
                            {(business.sourceProviders || snapshot?.sourceProviders || []).length > 0 ? (
                                (business.sourceProviders || snapshot?.sourceProviders || []).map((p, i) => (
                                    <p key={i} className="text-gray-600">• {p}</p>
                                ))
                            ) : (
                                <p className="text-gray-400">Unknown</p>
                            )}
                        </CardContent>
                    </Card>

                    {/* Audit Card */}
                    {audit && (
                        <Card>
                            <CardHeader><CardTitle className="text-sm">Digital Presence Audit</CardTitle></CardHeader>
                            <CardContent>
                                <div className="flex justify-between items-center mb-4">
                                    <span className="text-4xl font-bold text-blue-600">{audit.overallScore}<span className="text-lg text-gray-400">/100</span></span>
                                    <div className="flex flex-col items-end gap-1">
                                        <span className="text-xs px-2 py-1 bg-gray-100 rounded-full">{audit.confidence} Confidence</span>
                                        <span className={`text-xs px-2 py-1 rounded-full font-medium ${prospect.isSuppressed ? 'bg-red-100 text-red-800' : 'bg-purple-100 text-purple-800'}`}>
                                            {prospect.isSuppressed ? `Suppressed: ${prospect.suppressionReason}` : `Outreach: ${prospect.outreachState.replace(/_/g, " ")}`}
                                        </span>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-2 text-xs mb-4">
                                    {(Object.keys(audit.categoryScores) as Array<keyof typeof audit.categoryScores>).map(cat => (
                                        <div key={cat} className="flex justify-between bg-gray-50 px-2 py-1 rounded">
                                            <span className="capitalize text-gray-600">{cat.toLowerCase()}</span>
                                            <span className={`font-medium ${audit.categoryScores[cat].score >= 75 ? 'text-green-600' : audit.categoryScores[cat].score >= 50 ? 'text-yellow-600' : 'text-red-600'}`}>
                                                {audit.categoryScores[cat].score}
                                            </span>
                                        </div>
                                    ))}
                                </div>

                                {aiReport && (
                                    <div className="space-y-3 text-sm mt-4 pt-4 border-t">
                                        <div>
                                            <h4 className="font-semibold text-slate-800 text-xs uppercase mb-1">Executive Summary</h4>
                                            <p className="text-gray-600 whitespace-pre-wrap">{aiReport.executiveSummary}</p>
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}

                    {/* Outreach Timeline */}
                    <Card>
                        <CardHeader><CardTitle className="text-sm">Outreach Timeline</CardTitle></CardHeader>
                        <CardContent>
                            {sortedHistory.length === 0 ? (
                                <p className="text-sm text-gray-500">No outreach attempts yet.</p>
                            ) : (
                                <div className="relative border-l-2 border-gray-200 pl-4 space-y-6 ml-2">
                                    {sortedHistory.map(o => (
                                        <div key={o.id} className="relative">
                                            <div className={`absolute -left-[1.4rem] w-3 h-3 rounded-full top-1 ${o.deliveryStatus === 'BOUNCED' ? 'bg-red-500' :
                                                    o.deliveryStatus === 'DELIVERED' ? 'bg-green-500' :
                                                        o.status === "SENT" ? "bg-blue-500" : "bg-red-500"
                                                }`}></div>

                                            <div className="flex justify-between items-start">
                                                <span className="font-medium text-sm text-slate-800">{o.subject}</span>
                                                <span className={`text-xs px-2 py-0.5 rounded-full ${o.deliveryStatus === 'BOUNCED' ? 'bg-red-100 text-red-800' :
                                                        o.deliveryStatus === 'DELIVERED' ? 'bg-green-100 text-green-800' :
                                                            o.status === "SENT" ? "bg-blue-100 text-blue-800" : "bg-red-100 text-red-800"
                                                    }`}>
                                                    {o.deliveryStatus || o.status}
                                                </span>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">
                                                Stage {o.sequenceStage} | {o.type.replace(/_/g, " ")} | {new Date(o.sentAt).toLocaleString()}
                                            </p>
                                            {o.angle && <p className="text-xs text-purple-600 mt-1">Angle: {o.angle}</p>}
                                            {o.bounceReason && <p className="text-xs text-red-500 mt-1 font-medium">Bounce Reason: {o.bounceReason}</p>}
                                            {o.error && <p className="text-xs text-red-500 mt-1">Error: {o.error}</p>}

                                            <details className="mt-2 group">
                                                <summary className="text-xs text-blue-600 cursor-pointer hover:underline">View Email Content</summary>
                                                <div
                                                    className="mt-2 p-2 bg-slate-50 rounded text-xs text-gray-600 prose-sm max-w-none"
                                                    dangerouslySetInnerHTML={{ __html: o.body }}
                                                />
                                            </details>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </CardContent>
                    </Card>
                </div>

                {/* Right Column: Actions & Notes */}
                <div className="flex flex-col gap-6">

                    {/* Outreach Actions */}
                    <Card>
                        <CardHeader><CardTitle className="text-sm">Outreach Actions</CardTitle></CardHeader>
                        <CardContent className="flex flex-col gap-3">
                            <div>
                                <label className="text-xs text-gray-500 uppercase tracking-wide">Contact Email</label>
                                <div className="flex gap-2 mt-1">
                                    <Input
                                        type="email"
                                        value={emailInput}
                                        onChange={(e) => setEmailInput(e.target.value)}
                                        placeholder="name@business.com"
                                        className="text-sm"
                                    />
                                    <Button
                                        size="sm"
                                        variant="outline"
                                        onClick={handleSaveEmail}
                                        disabled={isSavingEmail || emailInput.trim() === (prospect.contactEmail || "")}
                                        className="shrink-0"
                                    >
                                        {isSavingEmail ? "Saving..." : "Save Email"}
                                    </Button>
                                </div>
                                {!hasUsableEmail && (
                                    <p className="text-[10px] text-yellow-600 mt-1">
                                        Enter an email above so the audit can be sent.
                                    </p>
                                )}
                            </div>

                            {!aiReport && (
                                <Button
                                    size="sm"
                                    variant="outline"
                                    onClick={handleRunAudit}
                                    disabled={isRunningAudit}
                                    className="w-full border-amber-500 text-amber-700 hover:bg-amber-50"
                                >
                                    {isRunningAudit ? "Running AI Audit (may take ~30s)..." : "Run AI Audit First"}
                                </Button>
                            )}

                            {!hasBeenContacted && (
                                <Button
                                    onClick={handleSendInitial}
                                    disabled={!hasUsableEmail || !aiReport || isStopStatus || isSendingInitial}
                                    className="w-full"
                                >
                                    {isSendingInitial ? "Sending..." : "Send Initial Audit Email"}
                                </Button>
                            )}

                            {hasBeenContacted && !isStopStatus && (
                                <>
                                    {!draft ? (
                                        <Button
                                            onClick={handleGenerateDraft}
                                            disabled={isGeneratingDraft || !hasUsableEmail}
                                            variant="outline"
                                            className="w-full border-purple-500 text-purple-700 hover:bg-purple-50"
                                        >
                                            {isGeneratingDraft ? "AI Generating..." : "Generate Next Follow-Up Draft"}
                                        </Button>
                                    ) : (
                                        <div className="flex flex-col gap-3 p-3 border border-purple-200 rounded-md bg-purple-50/50">
                                            <h4 className="text-xs font-semibold text-purple-900 uppercase">Review Draft (Stage {draft.stage})</h4>
                                            <Input
                                                value={draft.subject}
                                                onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
                                                placeholder="Subject"
                                                className="bg-white"
                                            />
                                            <Textarea
                                                value={draft.body}
                                                onChange={(e) => setDraft({ ...draft, body: e.target.value })}
                                                rows={6}
                                                placeholder="Email Body"
                                                className="bg-white text-sm"
                                            />
                                            <div className="text-xs text-purple-700 bg-purple-100 p-2 rounded">
                                                <p>Angle: {draft.angle}</p>
                                                <p>CTA: {draft.ctaType.replace(/_/g, " ")}</p>
                                            </div>
                                            <div className="flex gap-2">
                                                <Button size="sm" onClick={handleSendFollowUp} disabled={isSendingFollowUp} className="w-full">
                                                    {isSendingFollowUp ? "Sending..." : "Send Follow-Up"}
                                                </Button>
                                                <Button size="sm" variant="ghost" onClick={() => setDraft(null)} className="text-gray-500">
                                                    Cancel
                                                </Button>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}

                            {!prospect.isSuppressed && (
                                <Button size="sm" variant="ghost" className="text-red-500 hover:text-red-700 mt-2" onClick={handleSuppress}>
                                    Mark as Do Not Contact
                                </Button>
                            )}

                            {isStopStatus && (
                                <div className="text-xs text-center text-gray-500 italic p-2 bg-gray-50 rounded">
                                    Outreach stopped (State: {prospect.outreachState.replace(/_/g, " ")})
                                </div>
                            )}

                            {!aiReport && hasUsableEmail && <p className="text-xs text-yellow-600">The AI audit report is required before the initial email can be sent.</p>}
                            {actionError && <p className="text-xs text-red-500">{actionError}</p>}
                        </CardContent>
                    </Card>

                    {/* Notes */}
                    <Card>
                        <CardHeader><CardTitle className="text-sm">Notes & Activity</CardTitle></CardHeader>
                        <CardContent className="flex flex-col gap-3">
                            <Textarea
                                placeholder="Add a note (e.g., 'Called back, left voicemail')..."
                                value={noteText}
                                onChange={(e) => setNoteText(e.target.value)}
                                rows={3}
                            />
                            <Button size="sm" onClick={handleAddNote} disabled={!noteText.trim()}>Add Note</Button>

                            <div className="mt-4 space-y-3 max-h-60 overflow-y-auto">
                                {prospect.notes.length === 0 && <p className="text-xs text-gray-500">No notes yet.</p>}
                                {prospect.notes.slice().reverse().map(note => (
                                    <div key={note.id} className="text-xs bg-slate-50 p-2 rounded border border-slate-200">
                                        <p className="text-slate-700">{note.text}</p>
                                        <p className="text-gray-400 mt-1">{new Date(note.createdAt).toLocaleString()}</p>
                                    </div>
                                ))}
                            </div>
                        </CardContent>
                    </Card>
                </div>
            </div>
        </div>
    );
}
