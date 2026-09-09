import "server-only";
import { Business, EnrichmentData } from "@/types";
import { getBusinessesCollection, withDbRetry } from "@/lib/db";
import { logger } from "@/lib/logger";

import { getErrorMessage } from "@/lib/errors";
export class PersistenceService {
  async saveBusinesses(businesses: Business[]): Promise<void> {
    try {
      const collection = await withDbRetry(() => getBusinessesCollection());
      let savedCount = 0;
      let updatedCount = 0;

      for (const business of businesses) {
        const filterConditions: Record<string, unknown>[] = [];

        if (business.phone) {
          filterConditions.push({ phone: business.phone });
        }

        if (business.providerIds) {
          for (const [provider, id] of Object.entries(business.providerIds)) {
            if (id) {
              filterConditions.push({ [`providerIds.${provider}`]: id });
            }
          }
        }

        const filter = filterConditions.length > 0 ? { $or: filterConditions } : { id: business.id };

        const existing = await withDbRetry(() => collection.findOne(filter));

        const now = new Date().toISOString();
        const document = {
          ...business,
          updatedAt: now,
        };

        if (existing) {
          const existingDoc = existing as Partial<Business> & { createdAt?: string };

          document.sources = Array.from(new Set([...(existingDoc.sources || []), ...(business.sources || [])]));
          document.sourceProviders = Array.from(new Set([...(existingDoc.sourceProviders || []), ...(business.sourceProviders || [])]));
          document.categories = Array.from(new Set([...(existingDoc.categories || []), ...(business.categories || [])]));
          document.providerIds = { ...existingDoc.providerIds, ...business.providerIds };

          if (!document.phone && existingDoc.phone) document.phone = existingDoc.phone;
          if (!document.website && existingDoc.website) document.website = existingDoc.website;
          if (document.rating === undefined && existingDoc.rating !== undefined) document.rating = existingDoc.rating;
          if (document.reviewCount === undefined && existingDoc.reviewCount !== undefined) document.reviewCount = existingDoc.reviewCount;

          if (existingDoc.enrichment && !document.enrichment) document.enrichment = existingDoc.enrichment;

          await withDbRetry(() =>
            collection.updateOne(filter, {
              $set: {
                ...document,
                createdAt: existingDoc.createdAt || now,
              },
            })
          );
          updatedCount++;
        } else {
          await withDbRetry(() =>
            collection.insertOne({
              ...document,
              createdAt: now,
            })
          );
          savedCount++;
        }
      }

      logger.info(`[PersistenceService] Saved ${savedCount} new businesses, updated ${updatedCount} existing businesses.`);
    } catch (error) {
      logger.error("[PersistenceService] Failed to save businesses:", getErrorMessage(error));
    }
  }

  // --- NEW METHODS ADDED FOR MODULE 3 ---

  async getBusinessById(id: string): Promise<Business | null> {
    const collection = await withDbRetry(() => getBusinessesCollection());
    const doc = await withDbRetry(() => collection.findOne({ id }));
    return doc as unknown as Business | null;
  }

  async upsertBusiness(business: Business): Promise<void> {
    const collection = await withDbRetry(() => getBusinessesCollection());
    await withDbRetry(() =>
      collection.updateOne(
        { id: business.id },
        {
          $set: {
            ...business,
            updatedAt: new Date().toISOString(),
          },
          $setOnInsert: {
            createdAt: new Date().toISOString(),
          },
        },
        { upsert: true }
      )
    );
  }

async updateEnrichmentData(id: string, enrichment: EnrichmentData): Promise<void> {
    const collection = await withDbRetry(() => getBusinessesCollection());
    // We use $set to ONLY update the enrichment field, preserving discovery data
    await withDbRetry(() =>
      collection.updateOne(
        { id },
        {
          $set: {
            enrichment: enrichment,
            updatedAt: new Date().toISOString(),
          },
        }
      )
    );
  }

  /**
   * Permanently deletes a business document and any data tied to it.
   */
async deleteBusiness(id: string): Promise<void> {
    try {
      const collection = await withDbRetry(() => getBusinessesCollection());
      await withDbRetry(() => collection.deleteOne({ id }));
      logger.info(`[PersistenceService] Deleted business ${id}.`);
    } catch (error) {
      logger.error(`[PersistenceService] Failed to delete business ${id}:`, getErrorMessage(error));
    }
  }
}

export const persistenceService = new PersistenceService();