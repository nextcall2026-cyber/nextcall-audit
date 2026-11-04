"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Check, Image as ImageIcon, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { logger } from "@/lib/logger";
import { useToast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";

/**
 * Screenshot ingest + queue.
 *
 * The operator drops the Google listing screenshot (and the Facebook About one
 * when the business has a page), presses one button, and moves on to the next
 * business. Queueing is INSTANT and spends zero AI: the images are compressed
 * in the browser and stored, and the audit worker reads them in the
 * background with the one shared AI chain.
 *
 * Nothing here waits for the audit or for any model.
 */

interface JobRow {
  id: string;
  businessName: string;
  businessId: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "DEAD";
  /** "REPORT" rows are the small follow-up job that writes the AI report. */
  stage?: "AUDIT" | "REPORT";
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: string;
  finishedAt: string | null;
  waitingUntil: string | null;
}

interface QueueStats {
  QUEUED: number;
  RUNNING: number;
  DONE: number;
  FAILED: number;
  DEAD: number;
}

const EMPTY_STATS: QueueStats = { QUEUED: 0, RUNNING: 0, DONE: 0, FAILED: 0, DEAD: 0 };

type Slot = "google" | "facebook";

const SLOT_META: Record<Slot, { title: string; hint: string }> = {
  google: {
    title: "Google Business Profile",
    hint: "The listing with the name, rating and phone number.",
  },
  facebook: {
    title: "Facebook — About section (optional)",
    hint: "Skip it if the business has no Facebook page. This is where the email usually is.",
  },
};

const STATUS_STYLES: Record<JobRow["status"], { label: string; className: string }> = {
  QUEUED: { label: "Queued", className: "bg-slate-100 text-slate-700" },
  RUNNING: { label: "Working", className: "bg-blue-100 text-blue-700" },
  DONE: { label: "Done", className: "bg-emerald-100 text-emerald-700" },
  FAILED: { label: "Retrying", className: "bg-amber-100 text-amber-800" },
  DEAD: { label: "Failed", className: "bg-red-100 text-red-700" },
};

/**
 * Shrinks a pasted screenshot before upload: max 1600px on the long edge,
 * JPEG. Text screenshots stay perfectly readable for the vision model, and
 * the stored base64 lands far below the database's document limits — which
 * is what makes instant queueing safe.
 */
async function compressForUpload(file: File): Promise<File> {
  try {
    if (!file.type.startsWith("image/")) return file;
    const bitmap = await createImageBitmap(file);
    const maxDim = 1600;
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= 400_000) return file;

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.82)
    );
    if (!blob) return file;
    return new File([blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

export default function ScreenshotClient() {
  const toast = useToast();

  const [files, setFiles] = useState<Record<Slot, File | null>>({ google: null, facebook: null });
  const [previews, setPreviews] = useState<Record<Slot, string | null>>({ google: null, facebook: null });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queuedFlash, setQueuedFlash] = useState(false);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [stats, setStats] = useState<QueueStats>(EMPTY_STATS);
  const [queueError, setQueueError] = useState<string | null>(null);

  const googleInputRef = useRef<HTMLInputElement>(null);
  const facebookInputRef = useRef<HTMLInputElement>(null);
  const inputRefs: Record<Slot, React.RefObject<HTMLInputElement | null>> = {
    google: googleInputRef,
    facebook: facebookInputRef,
  };

  // --- queue polling -------------------------------------------------------
  const loadQueue = useCallback(async () => {
    try {
      const response = await fetch("/api/jobs", { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load the queue.");
      const data = (await response.json()) as { jobs: JobRow[]; stats: QueueStats };
      setJobs(data.jobs ?? []);
      setStats(data.stats ?? EMPTY_STATS);
      setQueueError(null);
    } catch (err) {
      setQueueError(getErrorMessage(err));
    }
  }, []);

  useEffect(() => {
    // Deferred by a tick so the first load is not a setState during render.
    const initial = setTimeout(() => void loadQueue(), 0);
    const timer = setInterval(() => void loadQueue(), 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [loadQueue]);

  // --- file handling -------------------------------------------------------
  const setFile = (slot: Slot, file: File | null) => {
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      const message = "That file is not an image. Use a PNG, JPG or WEBP screenshot.";
      setError(message);
      toast.error("Not an image", message);
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      const message = "That screenshot is larger than 8 MB. Please use a smaller image.";
      setError(message);
      toast.error("Screenshot too large", message);
      return;
    }

    setError(null);
    setQueuedFlash(false);

    setFiles((prev) => ({ ...prev, [slot]: file }));
    setPreviews((prev) => {
      if (prev[slot]) URL.revokeObjectURL(prev[slot]!);
      return { ...prev, [slot]: URL.createObjectURL(file) };
    });
  };

  const clearSlot = (slot: Slot) => {
    setFiles((prev) => ({ ...prev, [slot]: null }));
    setPreviews((prev) => {
      if (prev[slot]) URL.revokeObjectURL(prev[slot]!);
      return { ...prev, [slot]: null };
    });
  };

  const resetForm = () => {
    (["google", "facebook"] as Slot[]).forEach(clearSlot);
    setError(null);
  };

  // Ctrl+V anywhere: fills the first empty box (Google first).
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const items = event.clipboardData?.items;
      if (!items) return;

      for (const item of items) {
        if (!item.type.startsWith("image/")) continue;
        const file = item.getAsFile();
        if (!file) continue;

        event.preventDefault();
        setFile(files.google ? "facebook" : "google", file);
        break;
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.google]);

  // --- submit --------------------------------------------------------------
  // Only the Google listing is required — plenty of businesses have no
  // Facebook page, and refusing those would just lose a lead.
  const googleReady = Boolean(files.google);

  const handleQueue = async () => {
    if (!googleReady) {
      setError("Add the Google Business Profile screenshot first.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      // Compress in the browser first: a 1600px JPEG is perfectly readable
      // for the vision model and lands far below the database's document
      // limits, which is what makes instant queueing safe.
      const [googleFile, facebookFile] = await Promise.all([
        compressForUpload(files.google!),
        files.facebook ? compressForUpload(files.facebook) : Promise.resolve(null),
      ]);

      const formData = new FormData();
      formData.append("google", googleFile);
      if (facebookFile) formData.append("facebook", facebookFile);

      const response = await fetch("/api/businesses/manual", { method: "POST", body: formData });
      const data = await response.json().catch(() => ({}));

      if (response.status === 409 && data.duplicate) {
        const message: string = data.error ?? "This business is already in your app.";
        setError(message);
        toast.warning("Already added", message);
        return;
      }

      if (!response.ok) {
        const message: string = data.error ?? "The screenshots could not be read. Please try again.";
        setError(message);
        toast.error("Could not queue this business", message);
        return;
      }

      setQueuedFlash(true);
      toast.success(
        "Added to the queue",
        "Queueing is instant — the AI reads the screenshots and builds the audit in the background."
      );
      resetForm();
      void loadQueue();
    } catch (err) {
      const message = getErrorMessage(err);
      setError(message);
      toast.error("Could not queue this business", message);
      logger.error("[ScreenshotClient] Queue failed:", message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetry = async (jobId: string) => {
    try {
      const response = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: jobId }),
      });
      if (!response.ok) throw new Error("That job could not be re-queued.");
      toast.success("Back in the queue");
      void loadQueue();
    } catch (err) {
      toast.error("Could not re-queue", getErrorMessage(err));
    }
  };

  // --- render --------------------------------------------------------------
  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-muted-foreground">
        Drop the Google listing screenshot — plus the Facebook About section when the business has
        one — then press <span className="font-medium text-foreground">Add to queue</span>. Queueing
        is instant and spends no AI; one AI worker reads the screenshots and finishes everything in
        the background, and a send worker emails one audit every 2 minutes.
      </p>

      {/* Add a business */}
      <Card>
        <CardContent className="p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Add a business</h2>
            <span className="text-xs text-muted-foreground">
              Paste with Ctrl+V or drag the images in
            </span>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {(["google", "facebook"] as Slot[]).map((slot) => {
              const preview = previews[slot];
              const meta = SLOT_META[slot];

              return (
                <div key={slot} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-foreground">{meta.title}</span>
                    {preview && (
                      <button
                        type="button"
                        onClick={() => clearSlot(slot)}
                        className="text-xs text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${meta.title} screenshot`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => inputRefs[slot].current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") inputRefs[slot].current?.click();
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      setFile(slot, e.dataTransfer.files?.[0] ?? null);
                    }}
                    className={`flex h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-2 text-center transition-colors ${
                      preview
                        ? "border-emerald-400 bg-emerald-50/40"
                        : "border-border bg-muted/30 text-muted-foreground hover:border-primary/50 hover:bg-muted/50"
                    }`}
                  >
                    {preview ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={preview}
                        alt={`${meta.title} preview`}
                        className="h-full w-full rounded object-contain"
                      />
                    ) : (
                      <>
                        <ImageIcon className="h-5 w-5" />
                        <span className="text-xs font-medium">Drop or click</span>
                        <span className="text-[10px] text-muted-foreground/70">{meta.hint}</span>
                      </>
                    )}
                  </div>

                  <input
                    ref={inputRefs[slot]}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => setFile(slot, e.target.files?.[0] ?? null)}
                  />
                </div>
              );
            })}
          </div>

          {error && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
              {error}
            </div>
          )}

          {queuedFlash && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              <Check className="h-3.5 w-3.5" />
              <span className="font-medium">Queued instantly — zero AI spent here.</span>
              <span>
                The worker reads the screenshots, checks duplicates and builds the audit in the
                background.
              </span>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button onClick={handleQueue} disabled={submitting || !googleReady} className="gap-2">
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Queueing...
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" />
                  Add to queue
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              {!googleReady
                ? "The Google screenshot is required before queueing."
                : files.facebook
                  ? "Both screenshots are ready."
                  : "No Facebook screenshot — the audit will look for an email on the website instead."}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Queue */}
      <Card>
        <CardContent className="p-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Queue</h2>
            <div className="flex flex-wrap items-center gap-2">
              <StatChip label="Queued" value={stats.QUEUED} />
              <StatChip label="Working" value={stats.RUNNING} tone="blue" />
              <StatChip label="Done" value={stats.DONE} tone="emerald" />
              <StatChip label="Failed" value={stats.DEAD} tone={stats.DEAD > 0 ? "red" : "slate"} />
              <Button variant="ghost" size="sm" onClick={() => void loadQueue()} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </Button>
            </div>
          </div>

          {queueError && (
            <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              {queueError}
            </p>
          )}

          {jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing in the queue yet. Add your first business above.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {jobs.map((job) => {
                const style = STATUS_STYLES[job.status] ?? STATUS_STYLES.QUEUED;
                const canRetry = job.status === "DEAD" || job.status === "FAILED";

                return (
                  <li key={job.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{job.businessName}</span>
                        {job.stage === "REPORT" && (
                          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-700">
                            report
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${style.className}`}
                        >
                          {style.label}
                        </span>
                        {job.status === "QUEUED" && job.attempts > 0 && (
                          <span className="text-[10px] text-muted-foreground">
                            retry {job.attempts}/{job.maxAttempts}
                          </span>
                        )}
                      </div>

                      {job.lastError && (
                        <p className="max-w-2xl text-xs text-red-700">{job.lastError}</p>
                      )}

                      <span className="text-[10px] text-muted-foreground">
                        {new Date(job.createdAt).toLocaleString()}
                      </span>
                    </div>

                    {canRetry && (
                      <Button size="sm" variant="outline" onClick={() => void handleRetry(job.id)}>
                        Retry
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatChip({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "blue" | "emerald" | "red";
}) {
  const tones: Record<string, string> = {
    slate: "bg-slate-100 text-slate-700",
    blue: "bg-blue-100 text-blue-700",
    emerald: "bg-emerald-100 text-emerald-700",
    red: "bg-red-100 text-red-700",
  };

  return (
    <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${tones[tone]}`}>
      {label} {value}
    </span>
  );
}
