"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { Business, BoundingBox, AuditResult, AuditReport, AuditCategoryName } from "@/types";
import { opportunityService } from "@/services/opportunityService";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Download, Plus, Check, MapPin, Search } from "lucide-react";
import { logger } from "@/lib/logger";

import { getErrorMessage } from "@/lib/errors";
const MapView = dynamic(() => import("./MapView"), {
    ssr: false,
    loading: () => <p>Loading map...</p>,
});

const getScoreColor = (score: number) => {
    if (score >= 75) return "text-green-600";
    if (score >= 50) return "text-yellow-600";
    return "text-red-600";
};

type BusinessWithAudit = Business & {
    audit?: AuditResult;
    aiReport?: AuditReport;
};

const NICHE_OPTIONS = [
    "Plumbing",
    "Electrical",
    "HVAC",
    "Roofing",
    "Landscaping",
    "Cleaning",
    "Painting",
    "General Contractor",
    "Auto Repair",
    "Legal Services",
    "Real Estate",
    "Healthcare",
    "Salon & Spa",
    "Restaurant",
    "Retail",
    "Other...",
] as const;

const RADIUS_OPTIONS = [
    { label: "1 mile", value: 1609 },
    { label: "5 miles", value: 8047 },
    { label: "10 miles", value: 16093 },
    { label: "25 miles", value: 40234 },
    { label: "50 miles", value: 80467 },
];

const SESSION_KEY = "nextcall_discovery_state";

/** Bounding box for a center point plus radius, in meters. */
function boundingBoxFromCenter(center: { lat: number; lng: number }, radiusMeters: number): BoundingBox {
    const latDelta = radiusMeters / 111000;
    const lngDelta = radiusMeters / (111000 * Math.cos((center.lat * Math.PI) / 180));
    return {
        minLat: center.lat - latDelta,
        maxLat: center.lat + latDelta,
        minLng: center.lng - lngDelta,
        maxLng: center.lng + lngDelta,
    };
}

interface DiscoverySessionState {
    selectedNiche?: string;
    customNiche?: string;
    bounds?: BoundingBox | null;
    selectedCenter?: { lat: number; lng: number } | null;
    radiusMeters?: number;
    businesses?: BusinessWithAudit[];
    pipelineStatuses?: Record<string, boolean>;
}

function saveToSession(data: DiscoverySessionState) {
    try {
        const serialized = JSON.stringify(data);
        sessionStorage.setItem(SESSION_KEY, serialized);
    } catch {
        // sessionStorage may be full or unavailable
    }
}

function loadFromSession(): DiscoverySessionState | null {
    try {
        const raw = sessionStorage.getItem(SESSION_KEY);
        if (!raw) return null;
        return JSON.parse(raw) as DiscoverySessionState;
    } catch {
        return null;
    }
}

export default function DiscoveryClient() {
    const [selectedNiche, setSelectedNiche] = useState("");
    const [customNiche, setCustomNiche] = useState("");
    const [bounds, setBounds] = useState<BoundingBox | null>(null);
    const [selectedCenter, setSelectedCenter] = useState<{ lat: number; lng: number } | null>(null);
    const [radiusMeters, setRadiusMeters] = useState<number>(16093);
    const [businesses, setBusinesses] = useState<BusinessWithAudit[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [enrichingId, setEnrichingId] = useState<string | null>(null);
    const [auditingId, setAuditingId] = useState<string | null>(null);
    const [downloadingPdfId, setDownloadingPdfId] = useState<string | null>(null);
    const [addingToPipelineId, setAddingToPipelineId] = useState<string | null>(null);
    const [pipelineStatuses, setPipelineStatuses] = useState<Record<string, boolean>>({});

    // Restore previous session AFTER mount to avoid hydration mismatches
    // (server renders fallbacks, client restores saved state in the same tick)
    const hasHydrated = useRef(false);

    useEffect(() => {
        if (hasHydrated.current) return;
        hasHydrated.current = true;

        const saved = loadFromSession();
        if (!saved) return;

        queueMicrotask(() => {
            if (typeof saved.selectedNiche === "string") setSelectedNiche(saved.selectedNiche);
            if (typeof saved.customNiche === "string") setCustomNiche(saved.customNiche);
            if (saved.bounds) setBounds(saved.bounds);
            if (saved.selectedCenter) setSelectedCenter(saved.selectedCenter);
            if (typeof saved.radiusMeters === "number") setRadiusMeters(saved.radiusMeters);
            if (Array.isArray(saved.businesses)) setBusinesses(saved.businesses);
            if (saved.pipelineStatuses && typeof saved.pipelineStatuses === "object") {
                setPipelineStatuses(saved.pipelineStatuses);
            }
        });
    }, []);

    // Persist state to sessionStorage on changes
    useEffect(() => {
        if (!hasHydrated.current) return;
        saveToSession({
            selectedNiche,
            customNiche,
            bounds,
            selectedCenter,
            radiusMeters,
            businesses,
            pipelineStatuses,
        });
    }, [selectedNiche, customNiche, bounds, selectedCenter, radiusMeters, businesses, pipelineStatuses]);

    const handleBoundsChange = useCallback((newBounds: BoundingBox) => {
        setBounds(newBounds);
    }, []);

    const handleMapClick = useCallback((latlng: { lat: number; lng: number }) => {
        setSelectedCenter(latlng);
        setError(null);
    }, []);

    const radiusMiles = Math.round(radiusMeters / 1609.34);
    const query = selectedNiche === "Other..." ? customNiche : selectedNiche;
    const canSearch = !isLoading && selectedCenter && bounds && query.trim().length > 0;

    const handleSearch = async () => {
        if (!query) {
            setError("Please enter a search term.");
            return;
        }

        // Search the circle the user picked (center + radius). Without a
        // picked center, fall back to the current map viewport.
        const searchBox = selectedCenter
            ? boundingBoxFromCenter(selectedCenter, radiusMeters)
            : bounds;
        if (!searchBox) {
            setError("Please pick a location on the map first.");
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const response = await fetch("/api/discover", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ query, boundingBox: searchBox, targetResults: 50 }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: "Failed to fetch businesses" }));
                throw new Error(errData.error || "Failed to fetch businesses");
            }

            const data = await response.json();
            setBusinesses(data.businesses);
            setPipelineStatuses({});
        } catch (err) {
            setError(getErrorMessage(err));
            logger.error("[DiscoveryClient] Search failed:", getErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };

    const handleEnrich = async (business: BusinessWithAudit) => {
        setEnrichingId(business.id);
        setError(null);
        try {
            const response = await fetch("/api/enrich", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ businessId: business.id, business }),
            });
            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: "Enrichment failed" }));
                throw new Error(errData.error || "Enrichment failed");
            }
            const data = await response.json();
            setBusinesses(prev => prev.map(b => b.id === business.id ? data.business : b));
        } catch (err) {
            setError(getErrorMessage(err));
            logger.error("[DiscoveryClient] Enrichment failed:", getErrorMessage(err));
        } finally {
            setEnrichingId(null);
        }
    };

    const handleAudit = async (business: BusinessWithAudit) => {
        setAuditingId(business.id);
        try {
            const response = await fetch("/api/audit", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ businessId: business.id, business }),
            });
            if (!response.ok) throw new Error("Audit failed");
            const data = await response.json();

            setBusinesses(prev => prev.map(b =>
                b.id === business.id ? { ...b, audit: data.audit, aiReport: data.aiReport } : b
            ));
        } catch (err) {
            logger.error("[DiscoveryClient] Audit failed:", getErrorMessage(err));
        } finally {
            setAuditingId(null);
        }
    };

    const handleDownloadPdf = async (businessId: string, businessName: string) => {
        setDownloadingPdfId(businessId);
        setError(null);

        try {
            const response = await fetch("/api/reports/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ businessId }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: "Download failed" }));
                throw new Error(errData.error || "Failed to generate PDF");
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `NextCall_Audit_${businessName.replace(/\s/g, '_')}.pdf`;
            document.body.appendChild(a);
            a.click();

            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

        } catch (err) {
            setError(`PDF Download failed: ${getErrorMessage(err)}`);
            logger.error("[DiscoveryClient] PDF Download failed:", getErrorMessage(err));
        } finally {
            setDownloadingPdfId(null);
        }
    };

    const handleAddToPipeline = async (businessId: string) => {
        setAddingToPipelineId(businessId);
        setError(null);

        try {
            const response = await fetch("/api/prospects", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ businessId }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({ error: "Failed to add to pipeline" }));
                throw new Error(errData.error || "Failed to add to pipeline");
            }

            setPipelineStatuses(prev => ({ ...prev, [businessId]: true }));

        } catch (err) {
            setError(`Pipeline Error: ${getErrorMessage(err)}`);
            logger.error("[DiscoveryClient] Add to pipeline failed:", getErrorMessage(err));
        } finally {
            setAddingToPipelineId(null);
        }
    };

    return (
        <div className="flex h-[calc(100vh-8rem)] flex-col gap-4">
            {/* Search Controls */}
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Business Niche</label>
                    <select
                        value={selectedNiche}
                        onChange={(e) => {
                            setSelectedNiche(e.target.value);
                            if (e.target.value !== "Other...") setCustomNiche("");
                        }}
                        className="flex h-10 w-64 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        <option value="" disabled>Select business type</option>
                        {NICHE_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>{opt}</option>
                        ))}
                    </select>
                    {selectedNiche === "Other..." && (
                        <Input
                            type="text"
                            placeholder="Describe your niche"
                            value={customNiche}
                            onChange={(e) => setCustomNiche(e.target.value)}
                            className="mt-1.5 w-64"
                        />
                    )}
                </div>
                <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Search Radius</label>
                    <select
                        value={radiusMeters}
                        onChange={(e) => setRadiusMeters(parseInt(e.target.value))}
                        className="flex h-10 w-36 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                        {RADIUS_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>
                </div>
                <Button onClick={handleSearch} disabled={!canSearch} className="gap-2">
                    {isLoading ? (
                        <>
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            Searching...
                        </>
                    ) : (
                        <>
                            <Search className="h-4 w-4" />
                            Search Businesses
                        </>
                    )}
                </Button>
            </div>

            {/* Location Info */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {selectedCenter ? (
                    <span className="inline-flex items-center gap-1.5">
                        <MapPin className="h-3.5 w-3.5 text-primary" />
                        Selected location: {selectedCenter.lat.toFixed(6)}, {selectedCenter.lng.toFixed(6)}
                        <span className="mx-1.5 text-border">|</span>
                        Radius: {radiusMiles} miles
                    </span>
                ) : (
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground/60">
                        <MapPin className="h-3.5 w-3.5" />
                        Click the map to select a search location
                    </span>
                )}
            </div>

            {error && <p className="text-sm text-destructive font-medium">{error}</p>}

            <div className="flex flex-1 gap-4 overflow-hidden">
                {/* Map Section */}
                <div className="h-full w-2/3 rounded-lg border shadow-sm">
                    <MapView
                        businesses={businesses}
                        onBoundsChange={handleBoundsChange}
                        selectedCenter={selectedCenter}
                        onMapClick={handleMapClick}
                        initialCenter={selectedCenter}
                    />
                </div>

                {/* Results List Section */}
                <div className="h-full w-1/3 overflow-y-auto rounded-lg border p-4 shadow-sm">
                    <div className="mb-4">
                        <h3 className="text-lg font-semibold">Results ({businesses.length})</h3>
                        {businesses.length > 0 && businesses.some(b => (b.sourceProviders?.length || 1) > 1) && (
                            <p className="text-xs text-gray-400 mt-1">
                                ✓ Merged data from multiple sources
                            </p>
                        )}
                    </div>
                    <div className="flex flex-col gap-3">
                        {businesses.map((b) => {
                            const isEnriching = enrichingId === b.id;
                            const isAuditing = auditingId === b.id;
                            const isDownloading = downloadingPdfId === b.id;
                            const isAddingToPipeline = addingToPipelineId === b.id;
                            const isInPipeline = pipelineStatuses[b.id];
                            const isEnriched = b.enrichment?.status === "COMPLETED";
                            const audit: AuditResult | undefined = b.audit;
                            const aiReport: AuditReport | undefined = b.aiReport;
                            const oppScore = opportunityService.calculateScore(b);

                            return (
                                <Card key={b.id} className={b.status === "permanently_closed" ? "opacity-50" : ""}>
                                    <CardContent className="p-4">
                                        {/* Header: Name + Rating */}
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <p className="font-medium">{b.name}</p>
                                                {b.location?.address && <p className="text-sm text-gray-500">{b.location.address}</p>}
                                            </div>
                                            <div className="flex flex-col items-end gap-1">
                                                {b.rating && (
                                                    <span className="text-sm font-medium bg-green-100 text-green-800 px-2 py-1 rounded">
                                                        ★ {b.rating} ({b.reviewCount || 0})
                                                    </span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Contact Info */}
                                        <div className="mt-2 flex flex-wrap gap-2 text-xs text-gray-500">
                                            {b.phone && <span>📞 {b.phone}</span>}
                                            {b.website && <span className="text-blue-600">🌐 Website Found</span>}
                                        </div>

                                        {/* NextCall Opportunity Score */}
                                        <div className="mt-2 flex items-center gap-2">
                                            <span className="text-xs font-semibold">Lead Opportunity:</span>
                                            <span className={`text-sm font-bold ${
                                                oppScore.level === 'VERY_HIGH' ? 'text-red-600' :
                                                oppScore.level === 'HIGH' ? 'text-orange-600' :
                                                oppScore.level === 'MEDIUM' ? 'text-yellow-600' : 'text-gray-400'
                                            }`}>
                                                {oppScore.score}/100
                                            </span>
                                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                                                oppScore.level === 'VERY_HIGH' ? 'bg-red-100 text-red-800' :
                                                oppScore.level === 'HIGH' ? 'bg-orange-100 text-orange-800' :
                                                oppScore.level === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                                                'bg-gray-100 text-gray-600'
                                            }`}>
                                                {oppScore.level === 'VERY_HIGH' ? 'VERY HIGH' : oppScore.level}
                                            </span>
                                        </div>
                                        {oppScore.reasons.length > 0 && (
                                            <p className="text-[10px] text-gray-400 mt-0.5">
                                                {oppScore.reasons.slice(0, 2).join(" • ")}
                                                {oppScore.reasons.length > 2 && ` +${oppScore.reasons.length - 2} more`}
                                            </p>
                                        )}
                                        {(oppScore.unknownFactors?.length ?? 0) > 0 && (
                                            <p className="text-[10px] text-gray-300 mt-0.5 italic">
                                                ? {oppScore.unknownFactors?.length} unknown factor(s) — enrich for more data
                                            </p>
                                        )}

                                        {/* Action Buttons */}
                                        <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                                            {!isEnriched && (
                                                <Button size="sm" variant="outline" onClick={() => handleEnrich(b)} disabled={isEnriching || isAuditing}>
                                                    {isEnriching ? "Enriching..." : "1. Enrich Data"}
                                                </Button>
                                            )}

                                            {isEnriched && !audit && (
                                                <Button size="sm" onClick={() => handleAudit(b)} disabled={isAuditing}>
                                                    {isAuditing ? "Analyzing..." : "2. Run AI Audit"}
                                                </Button>
                                            )}

                                            {audit && aiReport && (
                                                <Button
                                                    size="sm"
                                                    variant="secondary"
                                                    onClick={() => handleDownloadPdf(b.id, b.name)}
                                                    disabled={isDownloading}
                                                    className="bg-purple-100 text-purple-800 hover:bg-purple-200"
                                                >
                                                    <Download className="h-3.5 w-3.5 mr-1.5" />
                                                    {isDownloading ? "Generating..." : "Download PDF"}
                                                </Button>
                                            )}

                                            <Button
                                                size="sm"
                                                variant={isInPipeline ? "ghost" : "outline"}
                                                onClick={() => handleAddToPipeline(b.id)}
                                                disabled={isAddingToPipeline || isInPipeline}
                                                className={isInPipeline ? "text-green-600" : "border-green-500 text-green-600 hover:bg-green-50"}
                                            >
                                                {isInPipeline ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                                                {isAddingToPipeline ? "Adding..." : isInPipeline ? "In Pipeline" : "Add to Pipeline"}
                                            </Button>
                                        </div>

                                        {/* Enrichment Display */}
                                        {isEnriched && b.enrichment && (
                                            <div className="mt-3 text-xs space-y-1 border-l-2 pl-2 border-gray-200">
                                                {(b.enrichment.emails?.length ?? 0) > 0 && <p>📧 {b.enrichment.emails![0].address}</p>}
                                                {b.enrichment.booking?.detected && <p className="text-yellow-700">⚠️ Booking: {b.enrichment.booking.systemName}</p>}
                                                {b.enrichment.preferredEmail && <p className="text-blue-600">★ {b.enrichment.preferredEmail}</p>}
                                            </div>
                                        )}

                                        {/* Audit & AI Report Display */}
                                        {audit && (
                                            <div className="mt-4 border-t-2 border-blue-100 pt-3 space-y-4">
                                                <div className="flex justify-between items-center">
                                                    <h4 className="font-semibold text-sm">Digital Presence Audit</h4>
                                                    <div className={`text-2xl font-bold ${getScoreColor(audit.overallScore)}`}>
                                                        {audit.overallScore}
                                                        <span className="text-xs font-normal text-gray-400">/100</span>
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs text-gray-500">Confidence:</span>
                                                    <span className={`text-xs px-2 py-0.5 rounded-full ${audit.confidence === 'HIGH' ? 'bg-green-100 text-green-800' :
                                                        audit.confidence === 'MEDIUM' ? 'bg-yellow-100 text-yellow-800' :
                                                            'bg-red-100 text-red-800'
                                                        }`}>
                                                        {audit.confidence}
                                                    </span>
                                                </div>

                                                <div className="grid grid-cols-2 gap-2 text-xs">
                                                    {(Object.keys(audit.categoryScores) as AuditCategoryName[]).map(cat => (
                                                        <div key={cat} className="flex justify-between bg-gray-50 px-2 py-1 rounded">
                                                            <span className="capitalize text-gray-600">{cat.toLowerCase()}</span>
                                                            <span className={`font-medium ${getScoreColor(audit.categoryScores[cat].score)}`}>
                                                                {audit.categoryScores[cat].score}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>

                                                {isAuditing && !aiReport && (
                                                    <div className="text-xs text-gray-500 animate-pulse mt-4">
                                                        <p>🤖 GPT-4o mini is analyzing the customer journey...</p>
                                                    </div>
                                                )}

                                                {aiReport && (
                                                    <div className="mt-4 space-y-3 text-sm bg-slate-50 p-3 rounded-md border border-slate-200">
                                                        <div>
                                                            <h5 className="font-semibold text-slate-800 text-xs uppercase tracking-wide mb-1">Executive Summary</h5>
                                                            <p className="text-slate-600 text-xs whitespace-pre-wrap">{aiReport.executiveSummary}</p>
                                                        </div>

                                                        <div>
                                                            <h5 className="font-semibold text-green-700 text-xs uppercase tracking-wide mb-1">Strengths</h5>
                                                            <ul className="list-disc list-inside text-xs text-slate-600 space-y-1">
                                                                {aiReport.strengths.map((s, i) => <li key={i}>{s}</li>)}
                                                            </ul>
                                                        </div>

                                                        <div>
                                                            <h5 className="font-semibold text-yellow-700 text-xs uppercase tracking-wide mb-1">Opportunities</h5>
                                                            <ul className="list-disc list-inside text-xs text-slate-600 space-y-1">
                                                                {aiReport.opportunities.map((o, i) => <li key={i}>{o}</li>)}
                                                            </ul>
                                                        </div>

                                                        <div>
                                                            <h5 className="font-semibold text-blue-700 text-xs uppercase tracking-wide mb-1">Customer Experience Impact</h5>
                                                            <p className="text-slate-600 text-xs whitespace-pre-wrap">{aiReport.customerExperienceImpact}</p>
                                                        </div>

                                                        <div className="pt-2 border-t border-slate-200">
                                                            <h5 className="font-semibold text-purple-800 text-xs uppercase tracking-wide mb-1">NextCall Relevance</h5>
                                                            <p className="text-slate-700 text-xs whitespace-pre-wrap font-medium">{aiReport.nextCallRelevance}</p>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            );
                        })}

                        {businesses.length === 0 && !isLoading && (
                            <p className="text-sm text-gray-500">Search for businesses to see results here.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
