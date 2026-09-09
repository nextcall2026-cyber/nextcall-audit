import "server-only";
import { OutreachRecord, OutreachStatus, OutreachStage, CTAType } from "@/types";
import { getOutreachCollection } from "@/lib/db";
import { prospectPersistenceService } from "@/services/prospectPersistenceService";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";


import { getErrorMessage } from "@/lib/errors";
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
async markAsSent(id: string, resendMessageId: string): Promise<void> {
    try {
      const collection = await getOutreachCollection();
      const sentAt = new Date().toISOString();

      await collection.updateOne(
        { id },
        { 
          $set: { 
            status: 'SENT' as OutreachStatus, 
            resendMessageId, 
            sentAt,
            deliveryStatus: 'ACCEPTED' // Assume accepted by provider
          } 
        }
      );
      logger.info(`[OutreachPersistenceService] Marked outreach ${id} as SENT.`);

      const record = await collection.findOne({ id });
      if (record) {
        // Update Prospect's lastContactedAt
        await prospectPersistenceService.updateLastContacted(record.prospectId, sentAt);
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
      }
    } catch (error) {
      logger.error(`[OutreachPersistenceService] Failed to record open for outreach ${id}:`, getErrorMessage(error));
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