"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Cog, Image as ImageIcon, Loader2, Plus, RefreshCw, X } from "lucide-react";
import { logger } from "@/lib/logger";
import { useToast } from "@/components/ui/toast";
import { getErrorMessage } from "@/lib/errors";

/**
 * Screenshot ingest + queue — rendered as the outreach machine's console.
 *
 * The operator drops the Google listing screenshot (and the Facebook About one
 * when the business has a page). Both boxes filled = auto-queue. The worker
 * reads the screenshots (NVIDIA nemotron-VL), checks duplicates, crawls the
 * website, scores the audit and hands the AI report to a queued job — and the
 * console shows every one of those stages live.
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
  /** Live machine phase while RUNNING (VISION READ, CRAWL, ...). */
  phase?: string | null;
  /** Which AI engine served this job (nvidia / grok / router). */
  engine?: string | null;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  /** Non-error outcome note, e.g. "Duplicate — already in the app". */
  note?: string | null;
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

interface SendTelemetry {
  enabled: boolean;
  dryRun: boolean;
  sentToday: number;
  dailyCap: number;
  capResetLabel: string | null;
  lastRunAt: string | null;
  lastRunResult: string | null;
}

/** Real pixel/file facts about a bay's screenshot, printed under the image. */
interface BayMedia {
  name: string;
  bytes: number;
  width: number;
  height: number;
}

/** The ticket the console prints after the queue accepts a set of bays. */
interface QueuedReceipt {
  jobId: string;
  hasFacebook: boolean;
  at: string;
  media: string[];
}

const EMPTY_STATS: QueueStats = { QUEUED: 0, RUNNING: 0, DONE: 0, FAILED: 0, DEAD: 0 };

type Slot = "google" | "facebook";

const SLOT_META: Record<Slot, { bay: string; title: string; hint: string }> = {
  google: {
    bay: "BAY-01",
    title: "Google listing",
    hint: "Name, rating, phone, website — the identity source.",
  },
  facebook: {
    bay: "BAY-02",
    title: "Facebook About",
    hint: "Optional — the email address usually lives here.",
  },
};

/** The machine, left to right. A stage lights up while a job is inside it. */
const STAGES = [
  "INTAKE",
  "VISION READ",
  "DEDUPE CHECK",
  "CRAWL",
  "AUDIT ENGINE",
  "PROSPECT",
  "AI REPORT",
  "AUTO-SEND",
] as const;

const STATUS_TOKENS: Record<JobRow["status"], { token: string; className: string }> = {
  QUEUED: { token: "WAIT", className: "text-[#8fa1b3]" },
  RUNNING: { token: "RUN", className: "text-[#f5a524]" },
  DONE: { token: "OK", className: "text-[#2fd583]" },
  FAILED: { token: "RETRY", className: "text-[#f5a524]" },
  DEAD: { token: "FAIL", className: "text-[#ff5f56]" },
};

const ENGINE_CELLS = [
  { id: "nvidia", label: "NVIDIA NEMOTRON-VL", role: "vision read" },
  { id: "grok", label: "GROQ // QWEN-VL", role: "vision fallback · reserve" },
  { id: "router", label: "ROUTER CHAIN", role: "reports · last resort" },
];

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

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
  const [media, setMedia] = useState<Record<Slot, BayMedia | null>>({ google: null, facebook: null });
  const [receipt, setReceipt] = useState<QueuedReceipt | null>(null);

  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [stats, setStats] = useState<QueueStats>(EMPTY_STATS);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [send, setSend] = useState<SendTelemetry | null>(null);
  const [clock, setClock] = useState("");

  const googleInputRef = useRef<HTMLInputElement>(null);
  const facebookInputRef = useRef<HTMLInputElement>(null);
  /** Re-armed whenever a screenshot is added/changed; spent by the auto-queue. */
  const autoQueuedRef = useRef(false);
  const inputRefs: Record<Slot, React.RefObject<HTMLInputElement | null>> = {
    google: googleInputRef,
    facebook: facebookInputRef,
  };

  // --- telemetry polling ---------------------------------------------------
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

  const loadSendState = useCallback(async () => {
    try {
      const response = await fetch("/api/automation/settings", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as {
        settings?: { autoSendEnabled?: boolean; dryRun?: boolean };
        usage?: {
          sentToday?: number;
          dailyCap?: number;
          capResetLabel?: string;
          lastRunAt?: string;
          lastRunResult?: string;
        };
      };
      setSend({
        enabled: data.settings?.autoSendEnabled ?? false,
        dryRun: data.settings?.dryRun ?? false,
        sentToday: data.usage?.sentToday ?? 0,
        dailyCap: data.usage?.dailyCap ?? 0,
        capResetLabel: data.usage?.capResetLabel ?? null,
        lastRunAt: data.usage?.lastRunAt ?? null,
        lastRunResult: data.usage?.lastRunResult ?? null,
      });
    } catch {
      // The console keeps its last known telemetry.
    }
  }, []);

  useEffect(() => {
    // Deferred by a tick so the first load is not a setState during render.
    const initial = setTimeout(() => {
      void loadQueue();
      void loadSendState();
    }, 0);
    // The queue poll is the console's heartbeat; the settings read is slow and
    // rarely changes, so it rides a longer interval to spare the free-tier DB.
    // Both polls pause while the tab is hidden — a hidden tab is not working,
    // and every poll is a billed serverless wake-up.
    const queueTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadQueue();
    }, 20_000);
    const sendTimer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void loadSendState();
    }, 30_000);
    return () => {
      clearTimeout(initial);
      clearInterval(queueTimer);
      clearInterval(sendTimer);
    };
  }, [loadQueue, loadSendState]);

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

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
    setReceipt(null);
    autoQueuedRef.current = false;

    setFiles((prev) => ({ ...prev, [slot]: file }));

    // Probe the real pixel size, so the bay can print a genuine readout under
    // the image instead of just showing a picture.
    const probeUrl = URL.createObjectURL(file);
    const probe = new Image();
    const record = (width: number, height: number) => {
      setMedia((prev) => ({
        ...prev,
        [slot]: {
          name: file.name || "pasted screenshot",
          bytes: file.size,
          width,
          height,
        },
      }));
      URL.revokeObjectURL(probeUrl);
    };
    probe.onload = () => record(probe.naturalWidth, probe.naturalHeight);
    probe.onerror = () => record(0, 0);
    probe.src = probeUrl;

    setPreviews((prev) => {
      if (prev[slot]) URL.revokeObjectURL(prev[slot]!);
      return { ...prev, [slot]: URL.createObjectURL(file) };
    });
  };

  const clearSlot = (slot: Slot) => {
    setFiles((prev) => ({ ...prev, [slot]: null }));
    setMedia((prev) => ({ ...prev, [slot]: null }));
    setPreviews((prev) => {
      if (prev[slot]) URL.revokeObjectURL(prev[slot]!);
      return { ...prev, [slot]: null };
    });
  };

  const resetForm = () => {
    (["google", "facebook"] as Slot[]).forEach(clearSlot);
    setError(null);
    autoQueuedRef.current = false;
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

      setReceipt({
        jobId: typeof data.jobId === "string" ? data.jobId : "unknown",
        hasFacebook: Boolean(data.hasFacebook),
        at: new Date().toLocaleTimeString("en-GB", { hour12: false }),
        media: [
          files.google
            ? `${files.google.name || "google listing"} · ${(files.google.size / 1024).toFixed(0)} KB`
            : null,
          files.facebook
            ? `${files.facebook.name || "facebook about"} · ${(files.facebook.size / 1024).toFixed(0)} KB`
            : null,
        ].filter((line): line is string => line !== null),
      });
      toast.success(
        "Added to the queue",
        "Queueing is instant — the machine reads the screenshots and builds the audit in the background."
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

  // Both boxes filled → queue automatically, no button press. One screenshot
  // only → the operator presses "Add to queue" themselves (their explicit
  // choice). The ref spends the auto-submit once per pair; adding or changing
  // a screenshot re-arms it, so a failed attempt never loops on its own.
  useEffect(() => {
    if (!(files.google && files.facebook) || submitting || autoQueuedRef.current) return;
    autoQueuedRef.current = true;
    void handleQueue();
    // handleQueue closes over this exact render's files — excluding it from
    // the deps is what prevents a double submit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files.google, files.facebook, submitting]);

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

  // --- live pipeline derivation ---------------------------------------------
  const activePhases = new Set(
    jobs.filter((job) => job.status === "RUNNING").map((job) => job.phase ?? "")
  );
  const sendActive = send?.lastRunAt
    ? Date.now() - new Date(send.lastRunAt).getTime() < 120_000
    : false;
  const reportWaiting = jobs.filter(
    (job) => job.stage === "REPORT" && (job.status === "QUEUED" || job.status === "RUNNING")
  ).length;
  const capReached = Boolean(send && send.dailyCap > 0 && send.sentToday >= send.dailyCap);
  const busy = stats.RUNNING > 0 || stats.QUEUED > 0;

  const engineState = (id: string): { active: boolean; last: string | null } => {
    const active = jobs.some((job) => {
      if (job.status !== "RUNNING") return false;
      // NVIDIA leads the vision chain, so a job mid-VISION-READ is served by
      // it until a fallback stamp says otherwise (the engine field lands the
      // moment the read returns).
      const effective = job.engine ?? (job.phase === "VISION READ" ? "nvidia" : job.stage === "REPORT" ? "router" : null);
      return effective === id;
    });
    const used = jobs.find(
      (job) => (job.engine ?? (job.stage === "REPORT" && job.status === "DONE" ? "router" : null)) === id
    );
    return { active, last: used?.finishedAt ?? used?.createdAt ?? null };
  };

  const stageState = (stage: string): boolean => {
    if (stage === "INTAKE") return stats.QUEUED > 0;
    if (stage === "AI REPORT") return activePhases.has("AI REPORT") || reportWaiting > 0;
    if (stage === "AUTO-SEND") return sendActive;
    return activePhases.has(stage);
  };

  const sendLabel = !send
    ? "LINKING"
    : send.dryRun
      ? "TEST MODE"
      : capReached
        ? "CAP REACHED"
        : send.enabled
          ? sendActive
            ? "DISPATCHING"
            : "ARMED"
          : "STANDBY";

  // --- render --------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      {/* TELEMETRY STRIP */}
      <div className="flex flex-wrap items-stretch gap-px border border-[#1b2530] bg-[#0c1116]">
        <McCell label="system" value="ONLINE" tone="green" led />
        <McCell label="vision engine" value="NVIDIA NEMOTRON-VL" />
        <McCell label="fallback chain" value="GROK ▸ ROUTER" />
        <McCell
          label="auto-send"
          value={sendLabel}
          tone={capReached ? "red" : send?.dryRun ? "amber" : send?.enabled ? "green" : "dim"}
          led
        />
        <McCell label="dispatched today" value={String(send?.sentToday ?? 0)} />
        <McCell label="queue" value={`${stats.QUEUED} ▸ ${stats.RUNNING} live ▸ ${stats.DONE} done`} />
        <McCell label="clock" value={clock || "--:--:--"} tone="amber" />
      </div>

      {/* AI ENGINE RACK — which brain is the machine using right now */}
      <section className="mc-panel">
        <div className="border-b border-[#1b2530] px-4 py-2.5">
          <span className="mc-label">ai engines // live routing</span>
        </div>
        <div className="grid gap-px bg-[#1b2530] sm:grid-cols-3">
          {ENGINE_CELLS.map((cell) => {
            const state = engineState(cell.id);
            const status = state.active
              ? { text: "ACTIVE — SERVING NOW", cls: "text-[#f5a524]", led: "mc-led-amber" }
              : state.last
                ? { text: `last used ${timeAgo(state.last)}`, cls: "text-[#2fd583]", led: "mc-led-green" }
                : { text: cell.id === "grok" ? "reserve · key not set" : "idle", cls: "text-[#64748b]", led: "mc-led-dim" };
            return (
              <div
                key={cell.id}
                className={`flex flex-col gap-1.5 px-4 py-3 ${state.active ? "bg-[#f5a524]/[0.06]" : "bg-[#0c1116]"}`}
              >
                <div className="flex items-center gap-2">
                  <span className={`mc-led ${status.led}`} />
                  <span
                    className={`text-[11px] font-semibold tracking-[0.1em] ${
                      state.active ? "text-[#f5a524]" : "text-[#c8d3dd]"
                    }`}
                  >
                    {cell.label}
                  </span>
                </div>
                <span className={`text-[10px] uppercase tracking-[0.14em] ${status.cls}`}>
                  {status.text}
                </span>
                <span className="text-[10px] text-[#4b5a68]">{cell.role}</span>
              </div>
            );
          })}
        </div>
      </section>

      {/* ENGINE BLOCK — the moving parts: fuel, load, pistons, gears */}
      <section className="mc-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2530] px-4 py-2.5">
          <span className="mc-label">engine block // load &amp; motion</span>
          <span className="flex items-center gap-2">
            <Cog className={`h-3.5 w-3.5 ${busy ? "mc-gear text-[#f5a524]" : "text-[#3b4a59]"}`} />
            <Cog className={`h-3 w-3 ${busy ? "mc-gear-rev text-[#8fa1b3]" : "text-[#3b4a59]"}`} />
            <span className={`mc-label ${busy ? "text-[#f5a524]" : ""}`}>
              {busy ? "engine running" : "engine idle"}
            </span>
          </span>
        </div>
        <div className="grid gap-px bg-[#1b2530] lg:grid-cols-4">
          <Gauge
            label="daily fuel"
            value={send?.sentToday ?? 0}
            max={send?.dailyCap || 300}
            unit="sent"
            tone={capReached ? "red" : "green"}
            footer={
              capReached
                ? `empty · refills ${send?.capResetLabel ?? "06:00"} local (00:00 UTC) — audits keep running`
                : `refills ${send?.capResetLabel ?? "06:00"} local (00:00 UTC)`
            }
          />
          <Gauge
            label="queue load"
            value={stats.QUEUED}
            max={Math.max(20, stats.QUEUED + stats.RUNNING)}
            unit="waiting"
            tone="amber"
            footer={`${stats.DONE} completed · ${stats.DEAD} dead`}
          />
          <Gauge
            label="live work"
            value={stats.RUNNING}
            max={4}
            unit="jobs"
            tone="amber"
            footer={jobs.find((job) => job.status === "RUNNING")?.phase ?? "no job in flight"}
          />

          <div className="flex flex-col justify-center gap-3 bg-[#0c1116] px-4 py-3">
            <span className="mc-label">cylinders</span>
            <div className="flex items-end gap-1.5">
              {Array.from({ length: 9 }).map((_, index) => (
                <span
                  key={index}
                  className={`w-1.5 bg-[#f5a524] ${busy ? "mc-piston" : ""}`}
                  style={{
                    height: `${10 + (index % 4) * 7}px`,
                    animationDelay: `${index * 0.08}s`,
                    opacity: busy ? 1 : 0.22,
                  }}
                />
              ))}
            </div>
            <span className="text-[10px] text-[#4b5a68]">
              {busy
                ? "intake feeding the line — audits continue even when sending pauses"
                : "standing by — load screenshots into the bays"}
            </span>
          </div>
        </div>
      </section>

      {/* PIPELINE SCHEMATIC */}
      <section className="mc-panel">
        <div className="flex items-center justify-between border-b border-[#1b2530] px-4 py-2.5">
          <span className="mc-label">
            pipeline <span className="mc-blink text-[#f5a524]">▮</span> live
          </span>
          <span className="mc-label">every stage below is real — fed by the workers</span>
        </div>
        <ol className="flex flex-wrap items-stretch gap-px bg-[#0c1116] p-3">
          {STAGES.map((stage, index) => {
            const active = stageState(stage);
            const badge = stage === "INTAKE" ? stats.QUEUED : stage === "AI REPORT" ? reportWaiting : null;
            return (
              <li key={stage} className="flex items-center">
                {index > 0 && (
                  <span
                    className={`mx-1 hidden h-px w-5 shrink-0 sm:block ${
                      active ? "mc-connector-live" : "bg-[#2b3948]"
                    }`}
                    aria-hidden
                  />
                )}
                <div
                  className={`flex items-center gap-2 border px-2.5 py-2 ${
                    active ? "mc-stage-active" : "border-[#1b2530] bg-[#10171e]"
                  }`}
                >
                  <span className={`mc-led ${active ? "mc-led-amber" : "mc-led-dim"}`} />
                  <span
                    className={`text-[10px] uppercase tracking-[0.14em] ${
                      active ? "text-[#f7c469]" : "text-[#64748b]"
                    }`}
                  >
                    {stage}
                  </span>
                  {badge !== null && badge > 0 && (
                    <span
                      className={`px-1 text-[10px] ${
                        active
                          ? "border border-[#f5a524]/45 bg-[#f5a524]/10 text-[#f5a524]"
                          : "border border-[#2b3948] text-[#8fa1b3]"
                      }`}
                    >
                      {badge}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {/* INTAKE CONSOLE */}
      <section className="mc-panel">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#1b2530] px-4 py-2.5">
          <span className="mc-label">intake // load screenshots</span>
          <span className="mc-label">paste with ctrl+v · both bays = auto-queue</span>
        </div>

        <div className="p-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {(["google", "facebook"] as Slot[]).map((slot) => {
              const preview = previews[slot];
              const meta = SLOT_META[slot];
              const loaded = Boolean(preview);

              return (
                <div key={slot} className="flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <span className="mc-label">
                      {meta.bay} <span className="text-[#c8d3dd]">// {meta.title}</span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <span className={`mc-led ${loaded ? "mc-led-green" : "mc-led-dim"}`} />
                      <span className={`text-[10px] uppercase tracking-[0.14em] ${loaded ? "text-[#2fd583]" : "text-[#64748b]"}`}>
                        {loaded ? "locked" : "no media"}
                      </span>
                    </span>
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
                    className={`mc-brackets flex h-52 cursor-pointer flex-col items-center justify-center p-3 text-center transition-colors ${
                      preview
                        ? "mc-viewport border border-[#2fd583]/40"
                        : "border border-dashed border-[#2b3948] bg-[#10171e] hover:border-[#f5a524]/40 hover:bg-[#f5a524]/[0.03]"
                    }`}
                  >
                    {preview ? (
                      <>
                        <div className="mc-viewport-bed flex min-h-0 flex-1 items-center justify-center">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={preview}
                            alt={`${meta.title} preview`}
                            className="max-h-full max-w-full border border-[#2b3948] bg-[#05070a] p-0.5 object-contain shadow-[0_0_28px_rgba(47,213,131,0.14)]"
                          />
                        </div>
                        <div className="mt-2 flex w-full items-center justify-between gap-2 border-t border-[#1b2530] pt-2">
                          <span
                            className="truncate text-[10px] text-[#8fa1b3]"
                            title={media[slot]?.name ?? ""}
                          >
                            {media[slot]?.name ?? "screenshot"}
                          </span>
                          <span className="shrink-0 text-[10px] tabular-nums text-[#2fd583]">
                            {media[slot] && media[slot]!.width > 0
                              ? `${media[slot]!.width}×${media[slot]!.height} · ${(media[slot]!.bytes / 1024).toFixed(0)} KB`
                              : files[slot]
                                ? `${(files[slot]!.size / 1024).toFixed(0)} KB`
                                : ""}
                          </span>
                        </div>
                      </>
                    ) : (
                      <>
                        <ImageIcon className="h-5 w-5 text-[#64748b]" />
                        <span className="text-[11px] uppercase tracking-[0.14em] text-[#8fa1b3]">
                          drop or click
                        </span>
                        <span className="text-[10px] text-[#4b5a68]">{meta.hint}</span>
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
            <div className="mt-4 border border-[#ff5f56]/40 bg-[#ff5f56]/10 px-3 py-2 text-[11px] text-[#ff9a93]">
              ! {error}
            </div>
          )}

          {receipt && (
            <div className="mc-receipt mt-4">
              <div className="flex items-center justify-between gap-3 border-b border-dashed border-[#2fd583]/30 px-4 py-2">
                <span className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-[#2fd583]">
                  <span className="mc-led mc-led-green" />
                  commit accepted · receipt
                </span>
                <button
                  type="button"
                  onClick={() => setReceipt(null)}
                  className="text-[#4b5a68] transition-colors hover:text-[#2fd583]"
                  aria-label="Dismiss receipt"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="grid gap-px bg-[#1b2530] sm:grid-cols-3">
                <div className="bg-[#0c1116] px-4 py-2.5">
                  <span className="mc-label">job ticket</span>
                  <p className="mt-1 text-[12px] text-[#f5a524]">
                    #{receipt.jobId.slice(0, 8)}
                  </p>
                </div>
                <div className="bg-[#0c1116] px-4 py-2.5">
                  <span className="mc-label">ai spent at intake</span>
                  <p className="mt-1 text-[12px] text-[#2fd583]">0 tokens — nothing read yet</p>
                </div>
                <div className="bg-[#0c1116] px-4 py-2.5">
                  <span className="mc-label">logged</span>
                  <p className="mt-1 text-[12px] text-[#c8d3dd]">{receipt.at}</p>
                </div>
              </div>

              <div className="px-4 py-3">
                <span className="mc-label">carried into the machine</span>
                <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-2">
                  {["VISION READ", "DEDUPE CHECK", "CRAWL", "AUDIT ENGINE", "PROSPECT", "AI REPORT"].map(
                    (step, index) => (
                      <span key={step} className="flex items-center gap-2">
                        {index > 0 && <span className="text-[#2b3948]" aria-hidden>▸</span>}
                        <span
                          className={`border px-2 py-1 text-[10px] uppercase tracking-[0.14em] ${
                            index === 0
                              ? "mc-stage-active border-[#f5a524] text-[#f7c469]"
                              : "border-[#1b2530] bg-[#10171e] text-[#64748b]"
                          }`}
                        >
                          {step}
                        </span>
                      </span>
                    )
                  )}
                </div>

                <p className="mt-3 text-[10px] text-[#4b5a68]">
                  received: {receipt.media.join("   ·   ")}
                  {receipt.hasFacebook ? "   ·   both bays" : "   ·   bay-01 only"}
                  {" — the worker picks this up within a minute"}
                </p>
              </div>
            </div>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              onClick={handleQueue}
              disabled={submitting || !googleReady}
              className="gap-2 rounded-none border border-[#2b3948] bg-[#10171e] px-4 font-mono text-[11px] uppercase tracking-[0.16em] text-[#c8d3dd] hover:bg-[#1b2530] hover:text-[#f5a524]"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Committing...
                </>
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Add to queue
                </>
              )}
            </Button>
            <span className="text-[10px] uppercase tracking-[0.14em] text-[#64748b]">
              {!googleReady
                ? "bay-01 (google) must be loaded first"
                : files.facebook
                  ? "both bays locked — auto-queue armed"
                  : "one bay loaded — manual queue only"}
            </span>
          </div>
        </div>
      </section>

      {/* OPERATIONS LOG */}
      <section className="mc-panel">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1b2530] px-4 py-2.5">
          <span className="mc-label">operations log // queue</span>
          <div className="flex flex-wrap items-center gap-2">
            <McCell label="queued" value={String(stats.QUEUED)} />
            <McCell label="running" value={String(stats.RUNNING)} tone="amber" led />
            <McCell label="done" value={String(stats.DONE)} tone="green" led />
            <McCell label="dead" value={String(stats.DEAD)} tone={stats.DEAD > 0 ? "red" : "dim"} led />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void loadQueue()}
              className="gap-1.5 rounded-none font-mono text-[10px] uppercase tracking-[0.14em] text-[#64748b] hover:bg-[#10171e] hover:text-[#c8d3dd]"
            >
              <RefreshCw className="h-3 w-3" />
              refresh
            </Button>
          </div>
        </div>

        {queueError && (
          <p className="border-b border-[#f5a524]/30 bg-[#f5a524]/5 px-4 py-2 text-[11px] text-[#f5a524]">
            ! {queueError}
          </p>
        )}

        {jobs.length === 0 ? (
          <p className="px-4 py-6 text-[11px] text-[#64748b]">
            no operations yet. load the intake bays above — the machine takes it from there.
          </p>
        ) : (
          <ul className="mc-terminal max-h-[460px] overflow-y-auto">
            {jobs.map((job) => {
              const token = STATUS_TOKENS[job.status] ?? STATUS_TOKENS.QUEUED;
              const running = job.status === "RUNNING";
              const canRetry = job.status === "DEAD" || job.status === "FAILED";
              const time = new Date(job.createdAt).toLocaleTimeString("en-GB", { hour12: false });

              return (
                <li key={job.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-[11.5px]">
                  <span className="w-[68px] shrink-0 text-[#4b5a68]">{time}</span>
                  <span className={`w-[52px] shrink-0 font-semibold ${token.className}`}>
                    [{token.token}]
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={running ? "text-[#f5a524]" : "text-[#c8d3dd]"}>
                      {job.businessName}
                    </span>
                    {job.stage === "REPORT" && (
                      <span className="text-[#4b5a68]"> // AI REPORT</span>
                    )}
                    {job.engine && (
                      <span className="border border-[#2b3948] px-1 text-[9px] uppercase tracking-[0.12em] text-[#8fa1b3]">
                        {job.engine}
                      </span>
                    )}
                    {job.status === "QUEUED" && job.attempts > 0 && (
                      <span className="text-[#4b5a68]"> · retry {job.attempts}/{job.maxAttempts}</span>
                    )}

                    {running && job.phase && (
                      <span className="ml-2 text-[#f5a524]">▸ {job.phase}</span>
                    )}
                    {job.note && <span className="block text-[#2fd583]">✓ {job.note}</span>}
                    {job.lastError && (
                      <span className="block text-[#ff9a93]">! {job.lastError}</span>
                    )}
                    {job.waitingUntil && (
                      <span className="block text-[#4b5a68]">
                        · next attempt {new Date(job.waitingUntil).toLocaleTimeString("en-GB", { hour12: false })}
                      </span>
                    )}
                  </span>

                  {canRetry && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void handleRetry(job.id)}
                      className="h-6 rounded-none border-[#2b3948] bg-transparent px-2 font-mono text-[10px] uppercase tracking-[0.14em] text-[#8fa1b3] hover:bg-[#10171e] hover:text-[#f5a524]"
                    >
                      requeue
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

/** A dial gauge — the machinery reads its own instruments. */
function Gauge({
  label,
  value,
  max,
  unit,
  tone = "amber",
  footer,
}: {
  label: string;
  value: number;
  max: number;
  unit: string;
  tone?: "amber" | "green" | "red";
  footer?: string;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const stroke = tone === "green" ? "#2fd583" : tone === "red" ? "#ff5f56" : "#f5a524";
  const needleAngle = -90 + ratio * 180;
  const arcLength = 100.5; // π × 32, the length of the dial arc

  return (
    <div className="flex flex-col gap-1.5 bg-[#0c1116] px-4 py-3">
      <span className="mc-label">{label}</span>
      <div className="flex items-center gap-3">
        <svg
          viewBox="0 0 88 56"
          className="h-14 w-[88px]"
          role="img"
          aria-label={`${label}: ${value} of ${max}`}
        >
          <path d="M 12 48 A 32 32 0 0 1 76 48" fill="none" stroke="#1b2530" strokeWidth="6" />
          <path
            d="M 12 48 A 32 32 0 0 1 76 48"
            fill="none"
            stroke={stroke}
            strokeWidth="6"
            className="mc-gauge-arc"
            strokeDasharray={`${(ratio * arcLength).toFixed(1)} 200`}
          />
          {[0, 0.25, 0.5, 0.75, 1].map((tick) => {
            const angle = ((-90 + tick * 180) * Math.PI) / 180;
            return (
              <line
                key={tick}
                x1={44 + Math.sin(angle) * 26}
                y1={48 - Math.cos(angle) * 26}
                x2={44 + Math.sin(angle) * 22}
                y2={48 - Math.cos(angle) * 22}
                stroke="#3b4a59"
                strokeWidth="1"
              />
            );
          })}
          <line
            x1="44"
            y1="48"
            x2="44"
            y2="22"
            stroke="#c8d3dd"
            strokeWidth="1.5"
            transform={`rotate(${needleAngle} 44 48)`}
          />
          <circle cx="44" cy="48" r="2.5" fill="#c8d3dd" />
        </svg>
        <div className="flex flex-col">
          <span className="text-[15px] leading-none" style={{ color: stroke }}>
            {value}
          </span>
          <span className="text-[10px] uppercase tracking-[0.14em] text-[#4b5a68]">
            / {max} {unit}
          </span>
        </div>
      </div>
      {footer && <span className="text-[10px] text-[#4b5a68]">{footer}</span>}
    </div>
  );
}

function McCell({
  label,
  value,
  tone = "dim",
  led = false,
}: {
  label: string;
  value: string;
  tone?: "dim" | "green" | "amber" | "red";
  led?: boolean;
}) {
  const toneClass =
    tone === "green"
      ? "text-[#2fd583]"
      : tone === "amber"
        ? "text-[#f5a524]"
        : tone === "red"
          ? "text-[#ff5f56]"
          : "text-[#c8d3dd]";
  const ledClass =
    tone === "green" ? "mc-led-green" : tone === "amber" ? "mc-led-amber" : tone === "red" ? "mc-led-red" : "mc-led-dim";

  return (
    <div className="flex min-w-[130px] flex-1 items-center gap-2 px-3 py-2">
      {led && <span className={`mc-led ${ledClass}`} />}
      <div className="flex min-w-0 flex-col">
        <span className="mc-label">{label}</span>
        <span className={`truncate text-[11.5px] ${toneClass}`}>{value}</span>
      </div>
    </div>
  );
}
