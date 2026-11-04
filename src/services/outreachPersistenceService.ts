import "server-only";
import { OutreachRecord, OutreachStatus, OutreachStage, CTAType, EmailProviderName } from "@/types";
import { getOutreachCollection } from "@/lib/db";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";


import { getErrorMessage } from "@/lib/errors";
import { notificationService } from "@/services/notificationService";
export class OutreachPersistenceService {
  /**
   * Checks if a business has already been successfully contacted.
   * Used for duplicate outreach prevention.
   */
  async hasBeenContacted(businessId: string): Promise<boolean> {
    try {
      const collection = await getOutreachCollection();

      const existing = await collection.findOne({
        businessId,
        status: "SENT",
      });

      return !!existing;
    } catch (error) {
      logger.error(
        `[OutreachPersistenceService] Error checking contact status for ${businessId}:`,
        getErrorMessage(error)
      );

      // Fail open, but log the error
      return false;
    }
  }

  /**
   * Finds a SENT outreach email previously delivered to an exact recipient
   * address. Backs the "one business, one email" send-time guard.
   */
  async findSentToRecipient(recipient: string): Promise<OutreachRecord | null> {
    try {
      const collection = await getOutreachCollection();
      const doc = await collection.findOne({ recipient, status: "SENT" });
      return (doc as unknown as OutreachRecord) ?? null;
    } catch (error) {
      logger.error(
        `[OutreachPersistenceService] Error finding sent record for ${recipient}:`,
        getErrorMessage(error)
      );
      return null;
    }
  }

  /**
   * Creates a new outreach record with PENDING status before sending the email.
   * Updated to include body and type.
   */
async createPendingOutreach(
    prospectId: string, 
    businessId: string, 
    recipient: string, 
    subject: string,
    body: string,
    type: 'INITIAL' | 'FOLLOW_UP',
    sequenceStage: OutreachStage,
    ctaType: CTAType | null,
    angle: string | null
  ): Promise<OutreachRecord | null> {
    try {
      const collection = await getOutreachCollection();
      
      const newRecord: OutreachRecord = {
        id: randomUUID(),
        prospectId,
        businessId,
        recipient,
        subject,
        body,
        type,
        sequenceStage, // NEW
        ctaType,       // NEW
        angle,         // NEW
        resendMessageId: null,
        status: 'PENDING',
        deliveryStatus: null,
        bounceReason: null,
        error: null,
        sentAt: new Date().toISOString(),
        deliveredAt: null,
        openedAt: null,
      };

      await collection.insertOne(newRecord);
      logger.info(`[OutreachPersistenceService] Created PENDING outreach (Stage ${sequenceStage}) record ${newRecord.id}.`);
      
      return newRecord;
    } catch (error) {
      logger.error(`[OutreachPersistenceService] Failed to create pending outreach:`, getErrorMessage(error));
      return null;
    }
  }

  /**
   * UPDATED: Updates an outreach record to SENT.
   * Outreach state transition is now handled atomically by the API route prior to sending.
   */
async markAsSent(
    id: string,
    resendMessageId: string,
    provider: EmailProviderName = "resend"
  ): Promise<void> {
    try {
      const collection = await getOutreachCollection();
      const sentAt = new Date().toISOString();

      await collection.updateOne(
        { id },
        { 
          $set: { 
            status: 'SENT' as OutreachStatus, 
            // Kept under its original name so the existing webhook lookup and
            // every historical record keep working; providerMessageId is the
            // provider-neutral name new code reads.
            resendMessageId,
            providerMessageId: resendMessageId,
            provider,
            sentAt,
            deliveryStatus: 'ACCEPTED' // Assume accepted by provider
          } 
        }
      );
      logger.info(`[OutreachPersistenceService] Marked outreach ${id} as SENT via ${provider}.`);

      const record = await collection.findOne({ id });
      if (record) {
        // Update Prospect's lastContactedAt
        await prospectPersistenceService.updateLastContacted(record.prospectId, sentAt);

        // A sent email means this audit has already been acted on, so it must
        // stop showing as "New / unread" in the pipeline. Doing it here covers
        // every send path at once: the manual button, the auto-send pass and
        // the follow-up sequence.
        await prospectPersistenceService.markAsReadAfterSend(record.prospectId);
        // Keep the pipeline stage in sync with outreach activity so the
        // Pipeline UI (CONTACTED / FOLLOW_UP sections) reflects real sends
        await prospectPersistenceService.advancePipelineStatusForContact(
          record.prospectId,
          record.type === 'FOLLOW_UP' ? 'FOLLOW_UP' : 'CONTACTED'
        );

        // In-app feed: every send is a visible step in the sequence.
        await notificationService.notify({
          type: "EMAIL_SENT",
          title: `Email sent: ${record.subject}`,
          body: `To ${record.recipient}${
            record.type === 'FOLLOW_UP' && record.sequenceStage
              ? ` · follow-up ${record.sequenceStage}`
              : " · initial audit email"
          }`,
          href: `/dashboard/pipeline/${record.prospectId}`,
          prospectId: record.prospectId,
          businessId: record.businessId,
          dedupeKey: `email-sent:${record.id}`,
        });
      }
    } catch (error) {
      logger.error(`[OutreachPersistenceService] Failed to mark outreach ${id} as SENT:`, getErrorMessage(error));
    }
  }

  /**
   * Updates an outreach record to FAILED
   * if the Resend API call fails.
   */
  async markAsFailed(
    id: string,
    errorMessage: string
  ): Promise<void> {
    try {
      const collection = await getOutreachCollection();

      await collection.updateOne(
        { id },
        {
          $set: {
            status: "FAILED" as OutreachStatus,
            error: errorMessage,
          },
        }
      );

      logger.warn(
        `[OutreachPersistenceService] Marked outreach ${id} as FAILED: ${errorMessage}`
      );
    } catch (error) {
      logger.error(
        `[OutreachPersistenceService] Failed to mark outreach ${id} as FAILED:`,
        getErrorMessage(error)
      );
    }
  }

  /**
   * Fetches all outreach records for a specific prospect.
   */
  async getOutreachHistory(
    prospectId: string
  ): Promise<OutreachRecord[]> {
    try {
      const collection = await getOutreachCollection();

      const cursor = collection.find({ prospectId });
      const docs = await cursor.toArray();

      return docs as unknown as OutreachRecord[];
    } catch (error) {
      logger.error(
        `[OutreachPersistenceService] Failed to get outreach history for ${prospectId}:`,
        getErrorMessage(error)
      );

      return [];
    }
  }


  /**
   * Fetches a single outreach record by its id.
   * Used by the unsubscribe endpoint to resolve the prospect from the
   * email footer link.
   */
  async getOutreachById(id: string): Promise<OutreachRecord | null> {
    try {
      const collection = await getOutreachCollection();
      const doc = await collection.findOne({ id });
      return doc as unknown as OutreachRecord | null;
    } catch (error) {
      logger.error(`[OutreachPersistenceService] Failed to get outreach record ${id}:`, getErrorMessage(error));
      return null;
    }
  }

  /**
   * Finds an outreach record by the provider's message id (Mailgun id, Mailtrap
   * message id, or Resend id). Used by the delivery webhooks, which need the
   * record behind an unsubscribe event without changing its delivery status.
   */
  async findByMessageId(messageId: string): Promise<OutreachRecord | null> {
    try {
      const collection = await getOutreachCollection();
      const doc = await collection.findOne({ resendMessageId: messageId });
      return (doc as unknown as OutreachRecord) ?? null;
    } catch (error) {
      logger.error(
        `[OutreachPersistenceService] Failed to find record for message ${messageId}:`,
        getErrorMessage(error)
      );
      return null;
    }
  }

  /**
   * NEW: Updates the delivery status of an outreach record based on webhook events.
   * Also returns the prospectId so the caller can suppress the prospect if needed.
   */
  /**
   * Deletes all outreach history records for a prospect.
   */
  async deleteOutreachForProspect(prospectId: string): Promise<void> {
    try {
      const collection = await getOutreachCollection();
      await collection.deleteMany({ prospectId });
      logger.info(`[OutreachPersistenceService] Deleted outreach for prospect ${prospectId}.`);
    } catch (error) {
      logger.error(`[OutreachPersistenceService] Failed to delete outreach for prospect ${prospectId}:`, getErrorMessage(error));
    }
  }

  /**
   * Replaces the HTML body of a PENDING outreach record.
   * Used to attach the open-tracking pixel once the record id is known.
   */
  async updateBody(id: string, body: string): Promise<void> {
    try {
      const collection = await getOutreachCollection();
      await collection.updateOne({ id, status: "PENDING" }, { $set: { body } });
    } catch (error) {
      logger.error(`[OutreachPersistenceService] Failed to update body for outreach ${id}:`, getErrorMessage(error));
    }
  }

  /**
   * Records the first time an outreach email was opened (tracking pixel hit).
   * Idempotent: only sets the timestamp if it is still null.
   */
  async markOpened(id: string): Promise<void> {
    try {
      const collection = await getOutreachCollection();
      const result = await collection.updateOne(
        { id, openedAt: null },
        { $set: { openedAt: new Date().toISOString() } }
      );
      if (result.modifiedCount > 0) {
        logger.info(`[OutreachPersistenceService] Recorded open for outreach ${id}.`);

        // In-app feed: the first open per prospect is the interesting signal
        // (the pixel fires on every image load, so later opens stay quiet).
        const opened = (await collection.findOne({ id })) as unknown as OutreachRecord | null;
        if (opened) {
          await notificationService.notify({
            type: "EMAIL_FIRST_OPEN",
            title: `Email opened: ${opened.subject}`,
            body: `To ${opened.recipient}${
              opened.type === "FOLLOW_UP" && opened.sequenceStage
                ? ` · follow-up ${opened.sequenceStage}`
                : " · initial email"
            }`,
            href: `/dashboard/pipeline/${opened.prospectId}`,
            prospectId: opened.prospectId,
            businessId: opened.businessId,
            dedupeKey: `first-open:${opened.prospectId}`,
          });
        }
      }
    } catch (error) {
      logger.error(`[OutreachPersistenceService] Failed to record open for outreach ${id}:`, getErrorMessage(error));
    }
  }

  /**
   * Counts SENT outreach emails since an ISO timestamp.
   * Backs the auto-send daily cap, so a burst can never burn the sending
   * domain's reputation (Resend free tier allows 100 emails/day).
   */
  async countSentSince(sinceIso: string): Promise<number> {
    try {
      const collection = await getOutreachCollection();
      const cursor = collection.find({ status: "SENT" });
      const docs = (await cursor.toArray()) as unknown as OutreachRecord[];
      return docs.filter((d) => d.sentAt && d.sentAt >= sinceIso).length;
    } catch (error) {
      logger.error(
        "[OutreachPersistenceService] Failed to count sends:",
        getErrorMessage(error)
      );
      return 0;
    }
  }

  /**
   * Sends since `sinceIso` per provider.
   *
   * This is the day's spend for the Mailgun-first routing: Mailgun is offered
   * while it has room, Mailtop takes the next stretch and Resend only the
   * overflow. Records written before the current provider set have no
   * `provider` field — those were all sent through Resend, so they are
   * counted there. Records from the retired Brevo era are ignored: Brevo is
   * gone and its sends must not consume today's Mailgun/Mailtop/Resend quota.
   */
  async countSentSinceByProvider(
    sinceIso: string
  ): Promise<Record<EmailProviderName, number>> {
    const counts: Record<EmailProviderName, number> = { mailgun: 0, mailtop: 0, resend: 0 };

    try {
      const collection = await getOutreachCollection();
      const cursor = collection.find({ status: "SENT" });
      const docs = (await cursor.toArray()) as unknown as OutreachRecord[];

      for (const doc of docs) {
        if (!doc.sentAt || doc.sentAt < sinceIso) continue;
        const provider = doc.provider as EmailProviderName | "brevo" | null | undefined;

        if (provider === "brevo") continue;
        const counted: EmailProviderName =
          provider === "mailgun" || provider === "mailtop" || provider === "resend"
            ? provider
            : "resend";
        counts[counted] += 1;
      }

      return counts;
    } catch (error) {
      logger.error(
        "[OutreachPersistenceService] Failed to count sends per provider:",
        getErrorMessage(error)
      );
      return counts;
    }
  }

  /**
   * Sends since `sinceIso`, split into initial audit emails and follow-ups.
   * The daily cap counts both, so the dashboard shows both.
   */  async countSentSinceByStage(
    sinceIso: string
  ): Promise<{ total: number; initial: number; followUps: number }> {
    try {
      const collection = await getOutreachCollection();
      const cursor = collection.find({ status: "SENT" });
      const docs = (await cursor.toArray()) as unknown as OutreachRecord[];
      const today = docs.filter((d) => d.sentAt && d.sentAt >= sinceIso);
      // OutreachStage is numeric: 0 = initial audit email, 1+ = follow-ups.
      const initial = today.filter((d) => d.sequenceStage === 0).length;
      return { total: today.length, initial, followUps: today.length - initial };
    } catch (error) {
      logger.error(
        "[OutreachPersistenceService] Failed to count sends by stage:",
        getErrorMessage(error)
      );
      return { total: 0, initial: 0, followUps: 0 };
    }
  }

  /**
   * Fetches all outreach records that were sent AND opened.
   * Used by the follow-up automation sweep. An open already implies delivery,
   * so this works even without the delivery webhook configured.
   */
  async getOpenedRecords(): Promise<OutreachRecord[]> {
    try {
      const collection = await getOutreachCollection();
      const cursor = collection.find({
        status: "SENT",
        openedAt: { $ne: null },
      });
      const docs = await cursor.toArray();
      return docs as unknown as OutreachRecord[];
    } catch (error) {
      logger.error("[OutreachPersistenceService] Failed to fetch opened outreach records:", getErrorMessage(error));
      return [];
    }
  }

  async updateDeliveryStatus(
    resendMessageId: string, 
    status: 'DELIVERED' | 'BOUNCED' | 'COMPLAINED', 
    reason: string | null
  ): Promise<string | null> {
    try {
      const collection = await getOutreachCollection();
      
      // Find the record by Resend Message ID
      const record = await collection.findOne({ resendMessageId });
      if (!record) {
        logger.warn(`[OutreachPersistenceService] Webhook: No record found for Message ID: ${resendMessageId}`);
        return null;
      }

      // IDEMPOTENCY CHECK: If the record is already in the requested status, skip processing
      if (record.deliveryStatus === status) {
        logger.info(`[OutreachPersistenceService] Idempotency: Event ${status} already processed for ${resendMessageId}. Skipping.`);
        return null; 
      }

      const updateData: Record<string, unknown> = {
        deliveryStatus: status,
        updatedAt: new Date().toISOString()
      };

      if (status === 'DELIVERED') {
        updateData.deliveredAt = new Date().toISOString();
      } else if (status === 'BOUNCED' || status === 'COMPLAINED') {
        updateData.bounceReason = reason;
      }

      await collection.updateOne(
        { resendMessageId },
        { $set: updateData }
      );

      logger.info(`[OutreachPersistenceService] Updated delivery status to ${status} for Message ID: ${resendMessageId}`);
      
      if (status === 'BOUNCED' || status === 'COMPLAINED') {
        // In-app feed: deliverability signals — these decide whether the
        // sending domain keeps its reputation.
        await notificationService.notify({
          type: status === 'BOUNCED' ? "EMAIL_BOUNCED" : "EMAIL_COMPLAINED",
          title: status === 'BOUNCED'
            ? "Email bounced — prospect suppressed"
            : "Spam complaint — prospect suppressed",
          body: reason
            ? `Reason: ${reason}`
            : `Prospect ${record.prospectId} will not be contacted again.`,
          href: `/dashboard/pipeline/${record.prospectId}`,
          prospectId: record.prospectId,
          businessId: record.businessId,
          dedupeKey: `${status.toLowerCase()}:${record.prospectId}`,
        });
      }

      // Return prospectId so we can suppress them if it bounced
      return record.prospectId;
    } catch (error) {
      logger.error(`[OutreachPersistenceService] Failed to update delivery status:`, getErrorMessage(error));
      return null;
    }
  }



}

export const outreachPersistenceService =
  new OutreachPersistenceService();