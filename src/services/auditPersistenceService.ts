import "server-only";
import { StoredAudit, AuditResult, AuditReport } from "@/types";
import { getAuditsCollection } from "@/lib/db";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";

import { getErrorMessage } from "@/lib/errors";
export class AuditPersistenceService {
  
  async saveAudit(businessId: string, audit: AuditResult): Promise<StoredAudit | null> {
    try {
      const collection = await getAuditsCollection();
      
      const auditRecord: StoredAudit = {
        id: randomUUID(),
        businessId,
        audit,
        createdAt: new Date().toISOString(),
      };

      await collection.insertOne(auditRecord);
      logger.info(`[AuditPersistenceService] Saved audit ${auditRecord.id} for business ${businessId}.`);
      
      return auditRecord;
    } catch (error) {
      logger.error(`[AuditPersistenceService] Failed to save audit for ${businessId}:`, getErrorMessage(error));
      return null;
    }
  }

  async getLatestAudit(businessId: string): Promise<StoredAudit | null> {
    try {
      const collection = await getAuditsCollection();
      const cursor = collection.find({ businessId }, { sort: { createdAt: -1 }, limit: 1 });
      const docs = await cursor.toArray();
      
      if (docs.length > 0) {
        return docs[0] as unknown as StoredAudit;
      }
      
      return null;
    } catch (error) {
      logger.error(`[AuditPersistenceService] Failed to get latest audit for ${businessId}:`, getErrorMessage(error));
      return null;
    }
  }

  // --- NEW METHOD TO SAVE AI REPORT ---
  async saveAIReport(auditId: string, aiReport: AuditReport): Promise<void> {
    try {
      const collection = await getAuditsCollection();
      
      // Update the existing audit document with the AI report
      await collection.updateOne(
        { id: auditId },
        { $set: { aiReport: aiReport } }
      );
      
      logger.info(`[AuditPersistenceService] Saved AI report for audit ${auditId}.`);
    } catch (error) {
      logger.error(`[AuditPersistenceService] Failed to save AI report for ${auditId}:`, getErrorMessage(error));
    }
  }

  /**
   * Deletes every audit record (and AI report) for a business.
   */
  async deleteAuditsForBusiness(businessId: string): Promise<void> {
    try {
      const collection = await getAuditsCollection();
      await collection.deleteMany({ businessId });
      logger.info(`[AuditPersistenceService] Deleted audits for business ${businessId}.`);
    } catch (error) {
      logger.error(`[AuditPersistenceService] Failed to delete audits for business ${businessId}:`, getErrorMessage(error));
    }
  }
}

export const auditPersistenceService = new AuditPersistenceService();