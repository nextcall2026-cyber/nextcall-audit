import "server-only";
import { Prospect, PipelineStatus, PriorityLevel, PriorityBreakdown, Note, OutreachSequenceState, OpportunityScore, Business, EnrichmentStatus } from "@/types";
import { getProspectsCollection } from "@/lib/db";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";

export class ProspectPersistenceService {
  
  /**
   * Creates a new prospect record for a given business with a durable snapshot.
   */
  async createProspect(
    businessId: string, 
    contactEmail: string | null, 
    opportunityScore?: OpportunityScore | null,
    business?: Business | null
  ): Promise<Prospect | null> {
    try {
      const collection = await getProspectsCollection();
      
      // Check if prospect already exists for this business
      const existing = await collection.findOne({ businessId });
      if (existing) {
        logger.info(`[ProspectPersistenceService] Prospect already exists for business ${businessId}.`);
        // Update snapshot if business data is provided
        if (business) {
          await collection.updateOne(
            { businessId },
            { 
              $set: { 
                businessSnapshot: this.createSnapshot(business),
                opportunityScore: opportunityScore || existing.existing.opportunityScore || null,
                updatedAt: new Date().toISOString() 
              } 
            }
          );
          const updated = await collection.findOne({ businessId });
          return updated as unknown as Prospect;
        }
        return existing as unknown as Prospect;
      }

      const now = new Date().toISOString();
    
      const newProspect: Prospect = {
        id: randomUUID(),
        businessId,
        pipelineStatus: 'NEW',
        outreachState: 'UNCONTACTED',
        priorityScore: null,
        priorityLevel: null,
        priorityBreakdown: null,
        businessSnapshot: business ? this.createSnapshot(business) : null,
        opportunityScore: opportunityScore || null,
        viewAddedAt: null,
        viewedAt: null,
        viewedCount: 0,
        contactEmail,
        lastContactedAt: null,
        nextFollowUpAt: null,
        notes: [],
        isSuppressed: false,
        suppressionReason: null,
        createdAt: now,
        updatedAt: now,
      };
      
      await collection.insertOne(newProspect);
      logger.info(`[ProspectPersistenceService] Created new prospect ${newProspect.id} for business ${businessId}.`);
      
      return newProspect;
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to create prospect for ${businessId}:`, error.message);
      return null;
    }
  }

  private createSnapshot(business: Business): Prospect['businessSnapshot'] {
    return {
      name: business.name,
      phone: business.phone || null,
      website: business.website || null,
      location: business.location || null,
      rating: business.rating ?? null,
      reviewCount: business.reviewCount ?? null,
      categories: business.categories || null,
      enrichmentStatus: (business.enrichment?.status as EnrichmentStatus) || null,
      enrichmentCompletedAt: business.enrichment?.completedAt || null,
      preferredEmail: business.enrichment?.preferredEmail || null,
      emails: business.enrichment?.emails?.map(e => e.address) || [],
      bookingDetected: business.enrichment?.booking?.detected || false,
      bookingUrl: business.enrichment?.booking?.url || null,
      socialPlatforms: business.enrichment?.socialProfiles?.map(s => s.platform) || [],
      sourceProviders: business.sourceProviders || [],
      sources: business.sources || [],
      crawlQuality: business.enrichment?.crawlMetadata?.crawlQuality || null,
    };
  }

  /**
   * Fetches a single prospect by its ID.
   */
  async getProspectById(id: string): Promise<Prospect | null> {
    try {
      const collection = await getProspectsCollection();
      const doc = await collection.findOne({ id });
      return doc as unknown as Prospect | null;
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to get prospect ${id}:`, error.message);
      return null;
    }
  }

  /**
   * Fetches a prospect by the associated Business ID.
   */
  async getProspectByBusinessId(businessId: string): Promise<Prospect | null> {
    try {
      const collection = await getProspectsCollection();
      const doc = await collection.findOne({ businessId });
      return doc as unknown as Prospect | null;
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to get prospect by business ${businessId}:`, error.message);
      return null;
    }
  }

  /**
   * Fetches all prospects, optionally filtered by status.
   */
  async getAllProspects(statusFilter?: PipelineStatus): Promise<Prospect[]> {
    try {
      const collection = await getProspectsCollection();
      const query = statusFilter ? { pipelineStatus: statusFilter } : {};
      
      // Sort by nextFollowUpAt ascending (nulls usually sort first or last depending on DB, we can handle UI side)
      const cursor = collection.find(query);
      const docs = await cursor.toArray();
      
      return docs as unknown as Prospect[];
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to get all prospects:`, error.message);
      return [];
    }
  }

  /**
   * Updates the pipeline status of a prospect.
   */
  async updateStatus(id: string, status: PipelineStatus): Promise<void> {
    try {
      const collection = await getProspectsCollection();
      await collection.updateOne(
        { id },
        { $set: { pipelineStatus: status, updatedAt: new Date().toISOString() } }
      );
      logger.info(`[ProspectPersistenceService] Updated status to ${status} for prospect ${id}.`);
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to update status for ${id}:`, error.message);
    }
  }

  /**
   * Sets the next follow-up date.
   */
  async setNextFollowUp(id: string, date: string | null): Promise<void> {
    try {
      const collection = await getProspectsCollection();
      await collection.updateOne(
        { id },
        { $set: { nextFollowUpAt: date, updatedAt: new Date().toISOString() } }
      );
      logger.info(`[ProspectPersistenceService] Set next follow-up to ${date} for prospect ${id}.`);
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to set follow-up for ${id}:`, error.message);
    }
  }


/**
   * Sets the last contacted timestamp.
   */
  async updateLastContacted(id: string, date: string): Promise<void> {
    try {
      const collection = await getProspectsCollection();
      await collection.updateOne(
        { id },
        { $set: { lastContactedAt: date, updatedAt: date } }
      );
      logger.info(`[ProspectPersistenceService] Updated lastContactedAt to ${date} for prospect ${id}.`);
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to update lastContacted for ${id}:`, error.message);
    }
  }

  /**
   * Updates the manually entered contact email for a prospect.
   * All outreach (initial audit email + follow-ups) will send to this address.
   */
  async updateContactEmail(id: string, email: string | null): Promise<void> {
    try {
      const collection = await getProspectsCollection();
      await collection.updateOne(
        { id },
        { $set: { contactEmail: email, updatedAt: new Date().toISOString() } }
      );
      logger.info(`[ProspectPersistenceService] Updated contact email for prospect ${id}: ${email}`);
    } catch (error: any) {
logger.error(`[ProspectPersistenceService] Failed to update contact email for ${id}:`, error.message);
    }
  }


  /**
   * Adds a timestamped note to the prospect's embedded notes array.
   */
  async addNote(id: string, text: string): Promise<void> {
    try {
      const collection = await getProspectsCollection();
      const newNote: Note = {
        id: randomUUID(),
        text,
        createdAt: new Date().toISOString(),
      };

      await collection.updateOne(
        { id },
        { 
          $push: { notes: newNote }, 
          $set: { updatedAt: new Date().toISOString() } 
        }
      );
      logger.info(`[ProspectPersistenceService] Added note to prospect ${id}.`);
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to add note for ${id}:`, error.message);
    }
  }

    /**
   * NEW: Updates the explicit outreach sequence state.
   */
  async updateOutreachState(id: string, state: OutreachSequenceState): Promise<void> {
    try {
      const collection = await getProspectsCollection();
      await collection.updateOne(
        { id },
        { $set: { outreachState: state, updatedAt: new Date().toISOString() } }
      );
      logger.info(`[ProspectPersistenceService] Updated outreachState to ${state} for prospect ${id}.`);
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to update outreach state for ${id}:`, error.message);
    }
  }


   /**
   * NEW: Updates the suppression status of a prospect.
   * Used when an email bounces or a prospect unsubscribes.
   */
  async updateSuppression(id: string, isSuppressed: boolean, reason: string | null): Promise<void> {
    try {
      const collection = await getProspectsCollection();
      await collection.updateOne(
        { id },
        { $set: { 
            isSuppressed, 
            suppressionReason: reason, 
            updatedAt: new Date().toISOString() 
          } 
        }
      );
      logger.info(`[ProspectPersistenceService] Updated suppression for ${id}: ${isSuppressed} (${reason})`);
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to update suppression for ${id}:`, error.message);
    }
  } 


  /**
   * NEW: Atomically claims an outreach state transition.
   * Prevents race conditions where two requests try to send the same stage.
   */
  async claimOutreachState(
    id: string, 
    expectedState: OutreachSequenceState, 
    newState: OutreachSequenceState
  ): Promise<boolean> {
    try {
      const collection = await getProspectsCollection();
      const result = await collection.findOneAndUpdate(
        { id, outreachState: expectedState },
        { $set: { outreachState: newState, updatedAt: new Date().toISOString() } },
        { returnDocument: 'after' }
      );
      return !!result;
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to claim state for ${id}:`, error.message);
      return false;
    }
  }

  /**
   * NEW: Reverts the outreach state if the email send fails after claiming.
   */
  async revertOutreachState(id: string, revertToState: OutreachSequenceState): Promise<void> {
    try {
      const collection = await getProspectsCollection();
      await collection.updateOne(
        { id },
        { $set: { outreachState: revertToState, updatedAt: new Date().toISOString() } }
      );
      logger.warn(`[ProspectPersistenceService] Reverted outreach state to ${revertToState} for prospect ${id} due to send failure.`);
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to revert state for ${id}:`, error.message);
    }
  }

  /**
   * Marks a prospect as viewed (sets viewAddedAt if not already set, increments viewCount, updates viewedAt).
   */
  async markAsViewed(id: string): Promise<void> {
    try {
      const collection = await getProspectsCollection();
      const now = new Date().toISOString();
      const prospect = await collection.findOne({ id });
      if (!prospect) return;
      const isFirstView = !prospect.viewAddedAt;
      const update: Record<string, any> = { 
        viewedAt: now, 
        updatedAt: now,
        viewedCount: (prospect.viewedCount || 0) + 1,
      };
      if (isFirstView) {
        update.viewAddedAt = now;
      }
      await collection.updateOne(
        { id },
        { $set: update }
      );
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to mark as viewed ${id}:`, error.message);
    }
  }

    /**
   * Permanently deletes a prospect record.
   */
  async deleteProspect(id: string): Promise<void> {
    try {
      const collection = await getProspectsCollection();
      await collection.deleteOne({ id });
      logger.info(`[ProspectPersistenceService] Deleted prospect ${id}.`);
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to delete prospect ${id}:`, error.message);
    }
  }

    /**
    * NEW: Updates the priority score, level, and breakdown for a prospect.
    */
  async updatePriority(
    id: string, 
    score: number | null, 
    level: PriorityLevel | null, 
    breakdown: PriorityBreakdown | null
  ): Promise<void> {
    try {
      const collection = await getProspectsCollection();
      await collection.updateOne(
        { id },
        { $set: { 
            priorityScore: score, 
            priorityLevel: level, 
            priorityBreakdown: breakdown,
            updatedAt: new Date().toISOString() 
          } 
        }
      );
      logger.info(`[ProspectPersistenceService] Updated priority for ${id}: ${score} (${level})`);
    } catch (error: any) {
      logger.error(`[ProspectPersistenceService] Failed to update priority for ${id}:`, error.message);
    }
  }

}

export const prospectPersistenceService = new ProspectPersistenceService();