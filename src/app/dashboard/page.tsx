import Link from "next/link";
import {
  getAuditJobsCollection,
  getAuditsCollection,
  getNotificationsCollection,
  getOutreachCollection,
  getProspectsCollection,
} from "@/lib/db";
import {
  automationSettingsService,
  nextUtcResetLabel,
  startOfUtcDayIso,
} from "@/services/automationSettingsService";
import { emailQuotaService } from "@/services/emailQuotaService";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { totalRemaining } from "@/lib/emailRouting";
import type { AppNotification, AuditJob, Prospect } from "@/types";
import ConsoleClock from "@/components/console/ConsoleClock";
import {
  BarRow,
  ConsoleHeader,
  ConsolePanel,
  Cylinders,
  Gauge,
  TelemetryCell,
} from "@/components/console/ConsoleUI";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  NEW: "NEW",
  READY_TO_CONTACT: "READY TO CONTACT",
  CONTACTED: "CONTACTED",
  FOLLOW_UP: "FOLLOW UP",
  QUALIFIED: "QUALIFIED",
  UNQUALIFIED: "UNQUALIFIED",
  STOPPED: "STOPPED",
};

const STATUS_ORDER = [
  "NEW",
  "READY_TO_CONTACT",
  "CONTACTED",
  "FOLLOW_UP",
  "QUALIFIED",
  "UNQUALIFIED",
  "STOPPED",
];

const JOB_TOKENS: Record<string, { token: string; tone: "dim" | "green" | "amber" | "red" }> = {
  QUEUED: { token: "WAIT", tone: "dim" },
  RUNNING: { token: "RUN", tone: "amber" },
  DONE: { token: "OK", tone: "green" },
  FAILED: { token: "RETRY", tone: "amber" },
  DEAD: { token: "FAIL", tone: "red" },
};

const TONE_CLASS: Record<string, string> = {
  dim: "text-[#8fa1b3]",
  green: "text-[#2fd583]",
  amber: "text-[#f5a524]",
  red: "text-[#ff5f56]",
};

/** Count without dragging whole collections over the wire, when possible. */
async function safeCount(
  collection: Awaited<ReturnType<typeof getProspectsCollection>>,
  filter: Record<string, unknown> = {}
): Promise<number> {
  try {
    const counter = (collection as unknown as {
      countDocuments?: (f: Record<string, unknown>, upperBound?: number) => Promise<number>;
    }).countDocuments;
    if (typeof counter === "function") {
      return await counter.call(collection, filter, 100_000);
    }
    return (await collection.find(filter).toArray()).length;
  } catch {
    return 0;
  }
}

async function loadProspects(): Promise<Prospect[]> {
  try {
    return (await (await getProspectsCollection()).find({}).toArray()) as unknown as Prospect[];
  } catch {
    return [];
  }
}

async function loadRecentJobs(): Promise<AuditJob[]> {
  try {
    return (await (await getAuditJobsCollection())
      .find({}, { sort: { createdAt: -1 }, limit: 12 })
      .toArray()) as unknown as AuditJob[];
  } catch {
    return [];
  }
}

async function loadRecentNotifications(): Promise<AppNotification[]> {
  try {
    return (await (await getNotificationsCollection())
      .find({}, { sort: { createdAt: -1 }, limit: 7 })
      .toArray()) as unknown as AppNotification[];
  } catch {
    return [];
  }
}

export default async function DashboardPage() {
  const settings = await automationSettingsService.getSettingsOrDefaults();

  const [
    prospects,
    recentJobs,
    notifications,
    auditsStored,
    emailsSentAllTime,
    queuedJobs,
    runningJobs,
    sentToday,
    capacities,
  ] = await Promise.all([
    loadProspects(),
    loadRecentJobs(),
    loadRecentNotifications(),
    (async () => {
      try {
        return await safeCount((await getAuditsCollection()) as never);
      } catch {
        return 0;
      }
    })(),
    (async () => {
      try {
        const collection = (await getOutreachCollection()) as never;
        return await safeCount(collection, { status: "SENT" });
      } catch {
        return 0;
      }
    })(),
    (async () => {
      try {
        return await safeCount((await getAuditJobsCollection()) as never, { status: "QUEUED" });
      } catch {
        return 0;
      }
    })(),
    (async () => {
      try {
        return await safeCount((await getAuditJobsCollection()) as never, { status: "RUNNING" });
      } catch {
        return 0;
      }
    })(),
    outreachPersistenceService.countSentSince(startOfUtcDayIso()).catch(() => 0),
    emailQuotaService.getCapacities().catch(() => null),
  ]);

  const highOpportunity = prospects.filter(
    (p) =>
      p.priorityLevel === "HOT" ||
      p.priorityLevel === "HIGH" ||
      (p.priorityScore ?? 0) >= 55
  ).length;

  const funnel = STATUS_ORDER.map((status) => ({
    status,
    label: STATUS_LABELS[status] ?? status,
    count: prospects.filter((p) => p.pipelineStatus === status).length,
  })).filter((row) => row.count > 0);

  const funnelMax = Math.max(1, ...funnel.map((row) => row.count));

  const topProspects = [...prospects]
    .sort((a, b) => (b.priorityScore ?? 0) - (a.priorityScore ?? 0))
    .slice(0, 8);

  const capReached = sentToday >= settings.dailyCap;
  const busy = queuedJobs + runningJobs > 0 || recentJobs.some((job) => job.status === "RUNNING");
  const livePhase = recentJobs.find((job) => job.status === "RUNNING")?.phase ?? "no job in flight";

  const formatTime = (iso: string): string => {
    try {
      return new Intl.DateTimeFormat("en-GB", {
        timeZone: settings.timezone,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      }).format(new Date(iso));
    } catch {
      return iso.slice(11, 19);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <ConsoleHeader
        eyebrow="NextCall outreach machine // unit 01"
        title="MISSION CONTROL"
        meta="Every number below is read live from the machine's own stores."
        right={
          <>
            <span className="mc-label">clock</span>
            <ConsoleClock className="text-[12px] text-[#f5a524]" />
            <Link
              href="/dashboard/screenshot"
              className="border border-[#2b3948] px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-[#8fa1b3] hover:border-[#f5a524]/50 hover:text-[#f5a524]"
            >
              open intake console
            </Link>
          </>
        }
      />

      {/* TELEMETRY */}
      <div className="flex flex-wrap items-stretch gap-px border border-[#1b2530] bg-[#0c1116]">
        <TelemetryCell label="pipeline" value={`${prospects.length} tracked`} led tone="green" />
        <TelemetryCell label="high opportunity" value={`${highOpportunity} hot / high`} tone={highOpportunity > 0 ? "amber" : "dim"} />
        <TelemetryCell label="audit store" value={`${auditsStored} audits`} />
        <TelemetryCell label="emails sent" value={`${emailsSentAllTime} all-time`} tone="green" />
        <TelemetryCell
          label="left today"
          value={capacities ? `${totalRemaining(capacities)} / ${settings.dailyCap}` : "unknown"}
          tone={capReached ? "red" : "green"}
        />
        <TelemetryCell label="queue" value={`${queuedJobs} ▸ ${runningJobs} live`} tone={busy ? "amber" : "dim"} led />
        <TelemetryCell
          label="auto-send"
          value={
            settings.dryRun
              ? "TEST MODE"
              : !settings.autoSendEnabled
                ? "STANDBY"
                : capReached
                  ? "CAP REACHED"
                  : "ARMED"
          }
          tone={capReached ? "red" : settings.autoSendEnabled ? "green" : "dim"}
          led
        />
      </div>

      {/* ENGINE BLOCK */}
      <ConsolePanel
        title="engine block // load & motion"
        right={<span className={`mc-label ${busy ? "text-[#f5a524]" : ""}`}>{busy ? "engine running" : "engine idle"}</span>}
      >
        <div className="grid gap-px bg-[#1b2530] lg:grid-cols-4">
          <Gauge
            label="daily fuel"
            value={sentToday}
            max={settings.dailyCap}
            unit="sent"
            tone={capReached ? "red" : "green"}
            footer={
              capReached
                ? `empty · refills ${nextUtcResetLabel(settings.timezone)} local (00:00 UTC) — audits keep running`
                : `refills ${nextUtcResetLabel(settings.timezone)} local (00:00 UTC)`
            }
          />
          <Gauge
            label="queue load"
            value={queuedJobs}
            max={Math.max(20, queuedJobs + runningJobs)}
            unit="waiting"
            tone="amber"
            footer={`${runningJobs} in flight`}
          />
          <Gauge
            label="audit store"
            value={auditsStored}
            max={Math.max(100, auditsStored)}
            unit="records"
            tone="amber"
            footer={`${prospects.length} prospects built from them`}
          />
          <Cylinders
            busy={busy}
            note={busy ? livePhase : "standing by — load screenshots into the intake bays"}
          />
        </div>
      </ConsolePanel>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* FUNNEL */}
        <ConsolePanel title="pipeline funnel" right={<span className="mc-label">{prospects.length} prospects</span>}>
          <div className="px-4 py-3">
            {funnel.length === 0 ? (
              <p className="py-4 text-[11px] text-[#4b5a68]">
                pipeline is empty — discover businesses or load screenshots to fill it.
              </p>
            ) : (
              funnel.map((row) => (
                <BarRow
                  key={row.status}
                  label={row.label}
                  value={row.count}
                  max={funnelMax}
                  tone={row.status === "NEW" ? "amber" : "dim"}
                  right={`${row.count}`}
                />
              ))
            )}
          </div>
        </ConsolePanel>

        {/* TOP OPPORTUNITIES */}
        <ConsolePanel
          title="top opportunities"
          right={
            <Link href="/dashboard/pipeline" className="mc-label hover:text-[#f5a524]">
              open pipeline →
            </Link>
          }
        >
          {topProspects.length === 0 ? (
            <p className="px-4 py-6 text-[11px] text-[#4b5a68]">nothing scored yet.</p>
          ) : (
            <ul className="mc-terminal">
              {topProspects.map((prospect) => {
                const name = prospect.businessSnapshot?.name ?? "Unknown business";
                const score = prospect.priorityScore ?? 0;
                return (
                  <li key={prospect.id} className="flex items-center gap-3 px-4 py-2 text-[11.5px]">
                    <span className={`w-[38px] shrink-0 font-semibold ${score >= 55 ? "text-[#f5a524]" : "text-[#8fa1b3]"}`}>
                      {score}
                    </span>
                    <Link href={`/dashboard/pipeline/${prospect.id}`} className="min-w-0 flex-1 truncate text-[#c8d3dd] hover:text-[#f5a524]">
                      {name}
                    </Link>
                    <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-[#4b5a68]">
                      {STATUS_LABELS[prospect.pipelineStatus] ?? prospect.pipelineStatus}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </ConsolePanel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* OPERATIONS LOG */}
        <ConsolePanel
          title="operations log"
          right={
            <Link href="/dashboard/screenshot" className="mc-label hover:text-[#f5a524]">
              full console →
            </Link>
          }
        >
          {recentJobs.length === 0 ? (
            <p className="px-4 py-6 text-[11px] text-[#4b5a68]">no operations yet.</p>
          ) : (
            <ul className="mc-terminal">
              {recentJobs.map((job) => {
                const token = JOB_TOKENS[job.status] ?? JOB_TOKENS.QUEUED;
                return (
                  <li key={job.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2 text-[11.5px]">
                    <span className="w-[64px] shrink-0 text-[#4b5a68]">{formatTime(job.createdAt)}</span>
                    <span className={`w-[52px] shrink-0 font-semibold ${TONE_CLASS[token.tone]}`}>
                      [{token.token}]
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={job.status === "RUNNING" ? "text-[#f5a524]" : "text-[#c8d3dd]"}>{job.businessName}</span>
                      {job.stage === "REPORT" && <span className="text-[#4b5a68]"> // AI REPORT</span>}
                      {job.status === "RUNNING" && job.phase && (
                        <span className="text-[#f5a524]"> ▸ {job.phase}</span>
                      )}
                      {job.note && <span className="block text-[#2fd583]">✓ {job.note}</span>}
                      {job.lastError && <span className="block text-[#ff9a93]">! {job.lastError}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </ConsolePanel>

        {/* RECENT ACTIVITY */}
        <ConsolePanel
          title="recent activity"
          right={
            <Link href="/dashboard/notifications" className="mc-label hover:text-[#f5a524]">
              all events →
            </Link>
          }
        >
          {notifications.length === 0 ? (
            <p className="px-4 py-6 text-[11px] text-[#4b5a68]">nothing happened yet.</p>
          ) : (
            <ul className="mc-terminal">
              {notifications.map((notification) => (
                <li key={notification.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2 text-[11.5px]">
                  <span className="w-[64px] shrink-0 text-[#4b5a68]">{formatTime(notification.createdAt)}</span>
                  <span className="min-w-0 flex-1">
                    {notification.href ? (
                      <Link href={notification.href} className="text-[#c8d3dd] hover:text-[#f5a524]">
                        {notification.title}
                      </Link>
                    ) : (
                      <span className="text-[#c8d3dd]">{notification.title}</span>
                    )}
                    {notification.body && (
                      <span className="block truncate text-[#4b5a68]">{notification.body}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-[10px] uppercase tracking-[0.14em] text-[#4b5a68]">
                    {notification.type.replace(/_/g, " ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </ConsolePanel>
      </div>
    </div>
  );
}
