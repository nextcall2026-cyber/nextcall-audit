"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import {
  Upload,
  Image as ImageIcon,
  Sparkles,
  Download,
  Plus,
  Check,
  MapPin,
} from "lucide-react";
import { logger } from "@/lib/logger";
import { useToast } from "@/components/ui/toast";
import { AuditResult, AuditReport, AuditCategoryName } from "@/types";

interface DuplicateMatch {
  businessId: string;
  name: string;
  prospectId: string | null;
  emailCount: number;
  lastEmailSentAt: string | null;
  suppressed: boolean;
}

interface ExtractedFields {
  name: string;
  phone: string;
  website: string;
  address: string;
  rating: string;
  reviewCount: string;
  category: string;
  email: string;
}

const EMPTY_FIELDS: ExtractedFields = {
  name: "",
  phone: "",
  website: "",
  address: "",
  rating: "",
  reviewCount: "",
  category: "",
  email: "",
};

const getScoreColor = (score: number) => {
  if (score >= 75) return "text-green-600";
  if (score >= 50) return "text-yellow-600";
  return "text-red-600";
};

export default function ScreenshotClient() {
  const toast = useToast();
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [duplicate, setDuplicate] = useState<DuplicateMatch | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState(false);
  const [creating, setCreating] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [addingToPipeline, setAddingToPipeline] = useState(false);
  const [inPipeline, setInPipeline] = useState(false);
  const [fields, setFields] = useState<ExtractedFields>(EMPTY_FIELDS);
  const [missing, setMissing] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    businessId: string;
    businessName: string;
    audit: AuditResult;
    aiReport: AuditReport | null;
  } | null>(null);

  const handleFile = (file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please paste/upload an image file (PNG, JPG, WEBP).");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Screenshot is too large (max 8 MB).");
      return;
    }
    setError(null);
    setExtracted(false);
    setResult(null);
    setFields(EMPTY_FIELDS);
    setMissing([]);
    setInPipeline(false);
    setNotes("");
    setDuplicate(null);
    setSelectedFile(file);
    if (previewUrl) window.URL.revokeObjectURL(previewUrl);
    setPreviewUrl(window.URL.createObjectURL(file));
  };

  // Paste from clipboard (Ctrl+V) anywhere on the page.
  // Only fires when the clipboard actually contains an image, so it never
  // interferes with pasting text into the data fields.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleFile(file);
          }
          break;
        }
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewUrl]);

  const handleExtract = async () => {
    if (!selectedFile) return;
    setExtracting(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("screenshot", selectedFile);

      const response = await fetch("/api/extract-screenshot", {
        method: "POST",
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Extraction failed");

      const f = data.fields as Record<string, unknown>;
      setFields({
        name: String(f.name ?? ""),
        phone: String(f.phone ?? ""),
        website: String(f.website ?? ""),
        address: String(f.address ?? ""),
        rating: f.rating !== null && f.rating !== undefined ? String(f.rating) : "",
        reviewCount: f.reviewCount !== null && f.reviewCount !== undefined ? String(f.reviewCount) : "",
        category: String(f.category ?? ""),
        email: String(f.email ?? ""),
      });
      setMissing(data.missing ?? []);
      setExtracted(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error("Extraction failed", message);
      logger.error("[ScreenshotClient] Extraction failed:", message);
    } finally {
      setExtracting(false);
    }
  };

  const handleCreate = async (force = false) => {
    if (!fields.name.trim()) {
      setError("Business name is required.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        name: fields.name.trim(),
        phone: fields.phone.trim() || null,
        website: fields.website.trim() || null,
        address: fields.address.trim() || null,
        rating: fields.rating.trim() ? Number(fields.rating) : null,
        reviewCount: fields.reviewCount.trim() ? Number(fields.reviewCount) : null,
        category: fields.category.trim() || null,
        email: fields.email.trim() || null,
        notes: notes.trim() || null,
      };
      if (force) payload.force = true;

      const response = await fetch("/api/businesses/manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (response.status === 409 && data.duplicate) {
        setDuplicate(data.match as DuplicateMatch);
        toast.warning(
          "Possible duplicate business",
          `"${data.match.name}" already exists${data.match.emailCount > 0 ? ` — ${data.match.emailCount} email(s) already sent to it` : ""}.`
        );
        return;
      }
      if (!response.ok) {
        const details = data.details?.map((d: { message?: string }) => d.message).join(", ");
        throw new Error(details || data.error || "Failed to create business");
      }

      setDuplicate(null);
      if (data.warning) {
        toast.warning("AI report failed", data.warning);
      } else {
        toast.success("Business created & audited");
      }
      setResult({
        businessId: data.businessId,
        businessName: data.business.name,
        audit: data.audit,
        aiReport: data.aiReport,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error("Could not create business", message);
      logger.error("[ScreenshotClient] Create + audit failed:", message);
    } finally {
      setCreating(false);
    }
  };

  const handleAddExistingToPipeline = async () => {
    if (!duplicate) return;
    setCreating(true);
    setError(null);
    try {
      const response = await fetch("/api/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: duplicate.businessId }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Failed to add to pipeline");
      toast.success("Existing business added to pipeline");
      router.push(`/dashboard/pipeline/${data.prospect.id}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      toast.error("Could not add to pipeline", message);
      logger.error("[ScreenshotClient] Add existing to pipeline failed:", message);
    } finally {
      setCreating(false);
    }
  };

  const handleCreateAnyway = async () => {
    setDuplicate(null);
    await handleCreate(true);
  };

  const handleDownloadPdf = async () => {
    if (!result) return;
    setDownloadingPdf(true);
    setError(null);
    try {
      const response = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: result.businessId }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Download failed" }));
        throw new Error(errData.error || "Failed to generate PDF");
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `NextCall_Audit_${result.businessName.replace(/\s/g, "_")}.pdf`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`PDF Download failed: ${message}`);
      toast.error("PDF download failed", message);
      logger.error("[ScreenshotClient] PDF download failed:", message);
    } finally {
      setDownloadingPdf(false);
    }
  };

  const handleAddToPipeline = async () => {
    if (!result) return;
    setAddingToPipeline(true);
    setError(null);
    try {
      const response = await fetch("/api/prospects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: result.businessId }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: "Failed to add to pipeline" }));
        throw new Error(errData.error || "Failed to add to pipeline");
      }
      setInPipeline(true);
      toast.success("Added to pipeline");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setError(`Pipeline Error: ${message}`);
      toast.error("Could not add to pipeline", message);
      logger.error("[ScreenshotClient] Add to pipeline failed:", message);
    } finally {
      setAddingToPipeline(false);
    }
  };

  const missingSet = new Set(missing);
  const fieldMeta: { key: keyof ExtractedFields; label: string; placeholder: string; type?: string; hint?: string }[] = [
    { key: "name", label: "Business name", placeholder: "e.g. JL Plumbing", hint: "Required" },
    { key: "phone", label: "Phone number", placeholder: "e.g. (512) 555-0123" },
    { key: "website", label: "Website", placeholder: "e.g. jlplumbing.com" },
    { key: "address", label: "Address", placeholder: "e.g. 123 Main St, Austin, TX" },
    { key: "rating", label: "Rating (0-5)", placeholder: "e.g. 4.7", type: "number" },
    { key: "reviewCount", label: "Review count", placeholder: "e.g. 123", type: "number" },
    { key: "category", label: "Category", placeholder: "e.g. Plumber" },
    { key: "email", label: "Email (optional)", placeholder: "e.g. info@business.com" },
  ];

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Screenshot a business listing from Google Maps, upload it here, and the AI will extract the
        visible details. Fields it could not read are listed below — fill them in manually, then
        create the business and run the full audit.
      </p>

      {/* Step 1: Upload + extract */}
      <Card>
        <CardContent className="p-6">
          <h2 className="text-sm font-semibold mb-3">1 · Upload the screenshot</h2>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <div
              className="flex h-44 w-full sm:w-56 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:bg-muted/50"
              onClick={() => fileInputRef.current?.click()}
            >
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewUrl} alt="Screenshot preview" className="h-full w-full rounded-lg object-contain" />
              ) : (
                <>
                  <Upload className="h-6 w-6" />
                  <span className="text-xs font-medium">Paste screenshot here (Ctrl+V)</span>
                  <span className="text-[10px] text-muted-foreground/60">or click to choose a file</span>
                  <span className="text-[10px] text-muted-foreground/60">PNG / JPG / WEBP · max 8 MB</span>
                </>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex flex-col gap-2">
              {selectedFile && !extracted && (
                <Button onClick={handleExtract} disabled={extracting} className="gap-2 w-fit">
                  {extracting ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                      Extracting...
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      Extract Data
                    </>
                  )}
                </Button>
              )}
              {extracted && (
                <Button variant="outline" size="sm" className="w-fit gap-2 text-green-600 border-green-500" onClick={() => fileInputRef.current?.click()}>
                  <ImageIcon className="h-4 w-4" />
                  Choose another screenshot
                </Button>
              )}
              {extracted && (
                <p className="text-xs text-green-600 flex items-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  Data extracted from the screenshot
                </p>
              )}
              {!selectedFile && (
                <p className="text-xs text-muted-foreground">
                  The listing photo must clearly show the business name, rating and contact details.
                </p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Extracted / edited fields */}
      {extracted && (
        <Card>
          <CardContent className="p-6">
            <h2 className="text-sm font-semibold mb-1">2 · Review &amp; complete the data</h2>
            <p className="text-xs text-muted-foreground mb-4">
              Values read from the screenshot are pre-filled. Correct anything wrong.
            </p>

            {missing.length > 0 && (
              <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  Not found in the screenshot — add manually if you have the info:
                </p>
                <p className="mt-1 text-xs text-amber-700">
                  {missing.join(" · ") || "Nothing missing"}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fieldMeta.map((meta) => {
                const isMissing = missingSet.has(meta.label) && fields[meta.key].trim() === "";
                return (
                  <div key={meta.key} className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {meta.label}
                      {isMissing && <span className="ml-1.5 text-amber-600">· not extracted</span>}
                      {meta.hint && <span className="ml-1.5 text-muted-foreground/60">({meta.hint})</span>}
                    </label>
                    <Input
                      type={meta.type ?? "text"}
                      value={fields[meta.key]}
                      placeholder={meta.placeholder}
                      onChange={(e) => setFields((prev) => ({ ...prev, [meta.key]: e.target.value }))}
                      className={isMissing ? "border-amber-400 focus-visible:ring-amber-400" : ""}
                    />
                  </div>
                );
              })}
            </div>

            {error && <p className="mt-4 text-sm font-medium text-destructive">{error}</p>}

            <div className="mt-5 flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                Anything else you know about this business?
              </label>
              <Textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={"e.g. Instagram: instagram.com/jlplumbing · books through Calendly (calendly.com/jlplumbing) · email: info@jlplumbing.com"}
              />
              <span className="text-[10px] text-muted-foreground/70">
                Social links, booking platform, email, phone, website — anything you verified on their
                website. These feed the audit so it doesn&apos;t miss signals the crawl couldn&apos;t find.
              </span>
            </div>

            {duplicate && (
              <div className="mt-5 rounded-md border border-amber-300 bg-amber-50 p-3">
                <p className="text-xs font-semibold text-amber-800">
                  ⚠ Possible duplicate: &quot;{duplicate.name}&quot; already exists
                </p>
                <p className="mt-1 text-xs text-amber-700">
                  In pipeline: {duplicate.prospectId ? "yes" : "no"} · Emails already sent: {duplicate.emailCount}
                  {duplicate.lastEmailSentAt ? ` · Last sent: ${new Date(duplicate.lastEmailSentAt).toLocaleDateString()}` : ""}
                  {duplicate.suppressed ? " · Suppressed (do not contact)" : ""}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {duplicate.prospectId ? (
                    <Link href={`/dashboard/pipeline/${duplicate.prospectId}`}>
                      <Button size="sm" variant="outline" className="border-amber-500 text-amber-700">
                        Open existing prospect
                      </Button>
                    </Link>
                  ) : (
                    <Button size="sm" variant="outline" onClick={handleAddExistingToPipeline} disabled={creating}>
                      Add existing business to pipeline
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={handleCreateAnyway} disabled={creating} className="text-slate-500">
                    Create duplicate anyway
                  </Button>
                </div>
              </div>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button onClick={() => handleCreate(false)} disabled={creating} className="gap-2">
                {creating ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    Creating &amp; auditing...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Create Business &amp; Run Audit
                  </>
                )}
              </Button>
              <span className="text-xs text-muted-foreground">
                Runs enrichment (website crawl if provided) + deterministic audit + AI report.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Result */}
      {result && (
        <Card>
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold">
                  Audit complete · {result.businessName}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Business ID: {result.businessId}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-3xl font-bold ${getScoreColor(result.audit.overallScore)}`}>
                  {result.audit.overallScore}
                  <span className="text-xs font-normal text-gray-400">/100</span>
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    result.audit.confidence === "HIGH"
                      ? "bg-green-100 text-green-800"
                      : result.audit.confidence === "MEDIUM"
                        ? "bg-yellow-100 text-yellow-800"
                        : "bg-red-100 text-red-800"
                  }`}
                >
                  {result.audit.confidence}
                </span>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
              {(Object.keys(result.audit.categoryScores) as AuditCategoryName[]).map((cat) => (
                <div key={cat} className="flex justify-between rounded bg-gray-50 px-2 py-1">
                  <span className="capitalize text-gray-600">{cat.toLowerCase()}</span>
                  <span className={`font-medium ${getScoreColor(result.audit.categoryScores[cat].score)}`}>
                    {result.audit.categoryScores[cat].score}
                  </span>
                </div>
              ))}
            </div>

            {result.aiReport && (
              <div className="mt-4 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                <h5 className="text-xs font-semibold uppercase tracking-wide text-slate-800">
                  Executive Summary
                </h5>
                <p className="text-xs whitespace-pre-wrap text-slate-600">
                  {result.aiReport.executiveSummary}
                </p>
                <p className="text-xs whitespace-pre-wrap text-slate-700 font-medium">
                  {result.aiReport.nextCallRelevance}
                </p>
              </div>
            )}

            <div className="mt-4 flex flex-wrap gap-2 border-t pt-4">
              <Button size="sm" variant="secondary" onClick={handleDownloadPdf} disabled={downloadingPdf} className="bg-purple-100 text-purple-800 hover:bg-purple-200">
                <Download className="h-3.5 w-3.5 mr-1.5" />
                {downloadingPdf ? "Generating..." : "Download PDF"}
              </Button>
              <Button
                size="sm"
                variant={inPipeline ? "ghost" : "outline"}
                onClick={handleAddToPipeline}
                disabled={addingToPipeline || inPipeline}
                className={inPipeline ? "text-green-600" : "border-green-500 text-green-600 hover:bg-green-50"}
              >
                {inPipeline ? <Check className="h-3.5 w-3.5 mr-1.5" /> : <Plus className="h-3.5 w-3.5 mr-1.5" />}
                {addingToPipeline ? "Adding..." : inPipeline ? "In Pipeline" : "Add to Pipeline"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}