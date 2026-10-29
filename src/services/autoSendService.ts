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
  startOfDayIso,
} from "@/services/automationSettingsService";
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
 *     (one-business-one-email, atomic state claim, idempotency key) applies.
 */

export interface AutoSendReport {
  ran: boolean;
  dryRun: boolean;
  candidates: number;
  sent: number;
  skipped: string;
}

/**
 * A provider-wide limit ("You have reached your daily email sending quota",
 * a 429, a rate limit) fails every remaining prospect too, so the pass stops
 * instead of burning a PDF render per attempt.
 */
export function isProviderLimitError(error: string | null | undefined): boolean {
  if (!error) return false;
  return /daily email sending quota|quota|rate limit|too many requests|429/i.test(error);
}

class AutoSendService {
  async runPass(): Promise<AutoSendReport> {
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
      startOfDayIso(settings.timezone)
    );
    let remaining = Math.max(0, settings.dailyCap - sentToday);

    if (remaining === 0) {
      return {
        ran: true,
        dryRun: settings.dryRun,
        candidates: 0,
        sent: 0,
        skipped: `daily cap of ${settings.dailyCap} reached`,
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

    for (const prospect of candidates) {
      if (remaining <= 0) break;

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

      const result = await outreachSendService.sendInitialOutreach(prospect.id);

      if (result.ok) {
        sent += 1;
        remaining -= 1;
      } else {
        logger.warn(`[AutoSendService] Skipped ${prospect.id}: ${result.error}`);

        // A provider-wide limit (Resend daily quota / rate limit) will fail
        // every remaining prospect too, and each attempt costs a PDF render
        // and a FAILED record. Stop the pass and retry after it resets.
        if (isProviderLimitError(result.error)) {
          providerLimit = result.error;
          break;
        }
      }
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
      skipped: "",
    };
  }
}

export const autoSendService = new AutoSendService();
