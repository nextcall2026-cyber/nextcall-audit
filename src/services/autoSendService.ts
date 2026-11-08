import "server-only";

import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { persistenceService } from "@/services/persistenceService";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { notificationService } from "@/services/notificationService";
import { outreachSendService } from "@/services/outreachSendService";
import { pickBestEmailForBusiness } from "@/services/contactEmailPicker";
import {
  automationSettingsService,
  currentHourInTimezone,
  isWithinBusinessHours,
  nextUtcResetLabel,
  startOfUtcDayIso,
} from "@/services/automationSettingsService";
import { emailQuotaService } from "@/services/emailQuotaService";
import { describeCapacity } from "@/lib/emailRouting";
import { logger } from "@/lib/logger";

/**
 * Auto-send pass: emails the initial audit to brand-new prospects that are
 * ready for it.
 *
 * Guardrails (all configurable):
 *   - OFF by default, and DRY-RUN by default — enabling real sending is a
 *     deliberate two-step decision.
 *   - any hour by default; an optional business-hours window can be switched on
 *   - hard daily cap (counted from real SENT records, not attempts)
 *   - only NEW / UNCONTACTED prospects with a contact email and no suppression
 *   - the actual send reuses outreachSendService, so every safety rail
 *     (one-business-one-email, atomic state claim, idempotency key) applies —
 *     and the audit is completed there before the email leaves.
 */

export interface AutoSendReport {
  ran: boolean;
  dryRun: boolean;
  candidates: number;
  sent: number;
  skipped: string;
}

/**
 * How many initial emails one pass may send.
 *
 * ONE. The send worker is invoked every 2 minutes and sends a single email —
 * a slow, steady drip that is gentle on the providers' rate limits and keeps
 * the pipeline moving around the clock. The 2-minute cron is the pacing; the
 * per-provider daily quotas are the ceiling.
 */
export const MAX_SENDS_PER_PASS = 1;

/**
 * AI reports generated inside one pass. Each is an LLM call, so the pass stays
 * inside its time budget and the rest are picked up 15 minutes later.
 */
export const MAX_REPORTS_PER_PASS = 3;

/**
 * Consecutive AI failures that mean the model itself is down rather than one
 * awkward business: stop the pass instead of spending a slow AI call per
 * remaining prospect only to fail the same way.
 */
export const MAX_AI_FAILURES_PER_PASS = 2;

/**
 * A provider-wide limit ("You have reached your daily email sending quota",
 * a 429, a rate limit) fails every remaining prospect too, so the pass stops
 * instead of burning a PDF render per attempt.
 *
 * Rejected credentials count as well: they are not per-prospect problems, and
 * every retry would fail the same way.
 */
export function isProviderLimitError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /daily email sending quota|quota|rate limit|too many requests|429|unrecognised ip|unauthor|api[- ]?key|forbidden|not configured|401|403/i.test(
    error
  );
}

class AutoSendService {
  async runPass(options: { maxSends?: number } = {}): Promise<AutoSendReport> {
    const maxSends = Math.max(0, options.maxSends ?? MAX_SENDS_PER_PASS);
    const settings = await automationSettingsService.getSettingsOrDefaults();

    if (!settings.autoSendEnabled) {
      return {
        ran: false,
        dryRun: settings.dryRun,
        candidates: 0,
        sent: 0,
        skipped: "auto-send disabled",
      };
    }

    const hour = currentHourInTimezone(settings.timezone);
    if (!isWithinBusinessHours(settings, hour)) {
      return {
        ran: false,
        dryRun: settings.dryRun,
        candidates: 0,
        sent: 0,
        skipped: settings.businessHoursEnabled
          ? `outside the send window (${hour}:00 ${settings.timezone})`
          : "outside the send window",
      };
    }

    const sentToday = await outreachPersistenceService.countSentSince(
      startOfUtcDayIso()
    );
    let remaining = Math.max(0, settings.dailyCap - sentToday);

    if (remaining === 0) {
      // The cap pauses SENDING only — audits and reports keep being built, so
      // tomorrow's window opens with a full queue ready to go out.
      return {
        ran: true,
        dryRun: settings.dryRun,
        candidates: 0,
        sent: 0,
        skipped: `daily cap of ${settings.dailyCap} reached — sending resumes at ${nextUtcResetLabel(settings.timezone)} local (00:00 UTC); audits keep running`,
      };
    }

    // If no provider can accept a single message today, stop before touching a
    // prospect. The router would refuse every attempt anyway, and each one
    // costs a PDF render, an AI call and a FAILED outreach record — 143 of them
    // in a single day, which buries the failures that actually matter.
    const sendPlan = await emailQuotaService.getSendPlan();
    if (sendPlan.length === 0) {
      const capacities = await emailQuotaService.getCapacities();
      const summary = describeCapacity(capacities);
      logger.warn(`[AutoSendService] Every provider is out for today (${summary}) — pass skipped.`);
      return {
        ran: true,
        dryRun: settings.dryRun,
        candidates: 0,
        sent: 0,
        skipped: `every provider is out for today (${summary}) — nothing attempted; each one resumes on its own reset`,
      };
    }

    const prospects = await prospectPersistenceService.getAllProspects();
    // The contact email is resolved per candidate below (prospect first, then
    // the best address the audit/website found), so a prospect whose address
    // was never copied out of the audit still gets its email.
    const candidates = prospects.filter(
      (p) =>
        p.pipelineStatus === "NEW" &&
        p.outreachState === "UNCONTACTED" &&
        !p.isSuppressed
    );

    let sent = 0;
    let providerLimit: string | null = null;
    let aiFailure: string | null = null;
    let aiFailures = 0;
    let passBudgetReached = false;
    let capReached = false;
    let reportsGenerated = 0;

    for (const prospect of candidates) {
      if (remaining <= 0) {
        capReached = true;
        break;
      }

      if (sent >= maxSends) {
        passBudgetReached = true;
        break;
      }

      const business = await persistenceService.getBusinessById(prospect.businessId);
      const name = business?.name || prospect.businessSnapshot?.name || "Unknown business";
      const email = prospect.contactEmail ?? pickBestEmailForBusiness(business);

      if (!email) {
        logger.info(`[AutoSendService] Skipped ${prospect.id}: no contact email in the audit or profile.`);
        continue;
      }

      if (settings.dryRun) {
        // Test mode: say what WOULD happen, send nothing, keep the cap untouched.
        await notificationService.notify({
          type: "EMAIL_SENT",
          title: `Test mode — would email: ${name}`,
          body: `Would send to ${email}. Test mode is ON, so nothing was sent. Open Notifications settings to start sending for real.`,
          href: `/dashboard/pipeline/${prospect.id}`,
          prospectId: prospect.id,
          businessId: prospect.businessId,
          dedupeKey: `auto-send-dry:${prospect.id}`,
        });
        continue;
      }

      const outcome = await outreachSendService.sendInitialOutreach(prospect.id, {
        // Generating a missing AI report is an LLM call, so it is budgeted per
        // pass. Once the budget is spent the prospect is skipped with an
        // AI_BUDGET code and picked up by the next pass 15 minutes later.
        allowAiReport: reportsGenerated < MAX_REPORTS_PER_PASS,
      });

      if (outcome.ok) {
        if (outcome.generatedReport) reportsGenerated += 1;
        sent += 1;
        remaining -= 1;

        // The AI just wrote and sent this prospect's audit email by itself, so
        // there is nothing left for the operator to review: mark the pipeline
        // row read instead of leaving it flagged "New / unread".
        await prospectPersistenceService.markAsReadAfterAutomatedSend(prospect.id);
      } else {
        logger.warn(`[AutoSendService] Skipped ${prospect.id}: ${outcome.error}`);

        if (outcome.code === "AI_BUDGET") continue;

        // The model itself is failing — every remaining candidate would spend
        // another slow AI call to fail the same way. Stop the pass.
        if (outcome.code === "AI_FAILED") {
          aiFailures += 1;
          if (aiFailures >= MAX_AI_FAILURES_PER_PASS) {
            aiFailure = outcome.error;
            break;
          }
          continue;
        }

        // A provider-wide limit (every provider out of daily quota, or
        // a rate limit) will fail every remaining prospect too, and each
        // attempt costs a PDF render and a FAILED record. Stop the pass and
        // retry after the quotas reset.
        if (isProviderLimitError(outcome.error)) {
          providerLimit = outcome.error;
          break;
        }
      }
    }

    if (aiFailure) {
      logger.warn(`[AutoSendService] Pass stopped early: ${aiFailure}`);
      await notificationService.notify({
        type: "AI_PROVIDER_ISSUE",
        title: "AI report generation is failing — sending paused",
        body: `${aiFailure.slice(0, 200)} ${Math.max(0, candidates.length - sent)} prospect(s) stay queued; the audit report is rebuilt on a later pass before anything is emailed.`,
        dedupeKey: "auto-send-ai-failure",
      });

      return {
        ran: true,
        dryRun: false,
        candidates: candidates.length,
        sent,
        skipped: `AI report generation failed ${aiFailures} time(s) after ${sent} send(s) — the rest stay queued`,
      };
    }

    if (providerLimit) {
      logger.warn(`[AutoSendService] Pass stopped early: ${providerLimit}`);
      await notificationService.notify({
        type: "AUTOMATION_ISSUE",
        title: "Email provider limit reached — sending paused",
        body: `${providerLimit.slice(0, 200)} ${candidates.length - sent} prospect(s) stay queued and are retried after the limit resets.`,
        dedupeKey: "email-provider-limit",
      });

      return {
        ran: true,
        dryRun: false,
        candidates: candidates.length,
        sent,
        skipped: `email provider limit reached after ${sent} send(s) — the rest stay queued`,
      };
    }

    logger.info(
      `[AutoSendService] Pass complete — ${candidates.length} candidate(s), ${sent} sent${settings.dryRun ? " (test mode)" : ""}.`
    );

    return {
      ran: true,
      dryRun: settings.dryRun,
      candidates: candidates.length,
      sent,
      skipped: capReached
        ? `daily cap of ${settings.dailyCap} reached — sending resumes at ${nextUtcResetLabel(settings.timezone)} local (00:00 UTC); audits keep running`
        : passBudgetReached
          ? `${maxSends} per pass — ${Math.max(0, candidates.length - sent)} still queued for the next pass`
          : "",
    };
  }
}

export const autoSendService = new AutoSendService();
