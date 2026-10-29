import "server-only";

import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { outreachPersistenceService } from "@/services/outreachPersistenceService";
import { notificationService } from "@/services/notificationService";
import {
  automationSettingsService,
  startOfDayIso,
} from "@/services/automationSettingsService";
import { logger } from "@/lib/logger";
import { getErrorMessage } from "@/lib/errors";

/**
 * One digest per day in the dashboard feed: what went out, what came back,
 * and how big the active list is. Deliberately short — it is a nudge, not a
 * report (the Notifications feed has the detail).
 */
class DailyDigestService {
  async maybeSendDigest(): Promise<{ sent: boolean }> {
    try {
      const settings = await automationSettingsService.getSettingsOrDefaults();
      const dayStart = startOfDayIso(settings.timezone);

      const sentToday = await outreachPersistenceService.countSentSince(dayStart);

      const opened = await outreachPersistenceService.getOpenedRecords();
      const openedToday = opened.filter(
        (r) => r.openedAt && r.openedAt >= dayStart
      ).length;

      const prospects = await prospectPersistenceService.getAllProspects();
      const newToday = prospects.filter((p) => p.createdAt >= dayStart).length;
      const replied = prospects.filter((p) => p.outreachState === "REPLIED").length;
      const suppressed = prospects.filter((p) => p.isSuppressed).length;

      await notificationService.notify({
        type: "DAILY_DIGEST",
        title: `Daily digest — ${new Date().toLocaleDateString()}`,
        body: [
          `${newToday} new prospect(s)`,
          `${sentToday} email(s) sent`,
          `${openedToday} opened today`,
          `${replied} replied (all time)`,
          `${suppressed} suppressed`,
        ].join(" · "),
        dedupeKey: `digest:${dayStart}`,
      });

      return { sent: true };
    } catch (error) {
      logger.error("[DailyDigestService] Failed:", getErrorMessage(error));
      return { sent: false };
    }
  }
}

export const dailyDigestService = new DailyDigestService();
