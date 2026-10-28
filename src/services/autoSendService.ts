import "server-only";

import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { persistenceService } from "@/services/persistenceService";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { notificationService } from "@/services/notificationService";
import { outreachSendService } from "@/services/outreachSendService";
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
 *   - business hours only, in the configured timezone
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

class AutoSendService {
  async runPass(): Promise<AutoSendReport> {
    const settings = await automationSettingsService.getSettings();

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
        skipped: `outside business hours (${hour}:00 ${settings.timezone})`,
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
    const candidates = prospects.filter(
      (p) =>
        p.pipelineStatus === "NEW" &&
        p.outreachState === "UNCONTACTED" &&
        Boolean(p.contactEmail) &&
        !p.isSuppressed
    );

    let sent = 0;

    for (const prospect of candidates) {
      if (remaining <= 0) break;

      const business = await persistenceService.getBusinessById(prospect.businessId);
      const name = business?.name || prospect.businessSnapshot?.name || "Unknown business";

      if (settings.dryRun) {
        // Dry run: say what WOULD happen, send nothing, keep the cap untouched.
        await notificationService.notify({
          type: "EMAIL_SENT",
          title: `Dry run — would email: ${name}`,
          body: "Auto-send is in dry-run mode, so nothing was sent. Open Notifications settings to switch it live.",
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
      }
    }

    logger.info(
      `[AutoSendService] Pass complete — ${candidates.length} candidate(s), ${sent} sent${settings.dryRun ? " (dry run)" : ""}.`
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
