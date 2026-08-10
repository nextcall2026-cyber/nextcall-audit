import "server-only";
import { Business, DiscoveryQualitySignals } from "@/types";
import { logger } from "@/lib/logger";

export class DeduplicationService {

  deduplicate(businesses: Business[]): Business[] {
    const seen = new Map<string, Business>();
    const result: Business[] = [];

    for (const current of businesses) {
      const matchKey = this.findMatchKey(current, seen);

      if (matchKey) {
        const existing = seen.get(matchKey);
        if (existing) {
          this.mergeBusinesses(existing, current);
          logger.debug(`[DeduplicationService] Merged duplicate: ${current.name} into ${existing.name}`);
        }
      } else {
        const key = `uuid:${current.id}`;
        seen.set(key, current);
        result.push(current);

        if (current.phone) seen.set(`phone:${this.normalizePhone(current.phone)}`, current);
        if (current.website) seen.set(`domain:${this.normalizeDomain(current.website)}`, current);
        if (current.providerIds) {
          for (const [provider, id] of Object.entries(current.providerIds)) {
            seen.set(`pid:${provider}:${id}`, current);
          }
        }
      }
    }

    for (const business of result) {
      business.discoverySignals = this.calculateQualitySignals(business);
    }

    logger.info(`[DeduplicationService] Deduplicated ${businesses.length} businesses down to ${result.length} unique records.`);
    return result;
  }

  private calculateQualitySignals(business: Business): DiscoveryQualitySignals {
    let filledFields = 0;
    const totalFields = 5;

    if (business.website) filledFields++;
    if (business.phone) filledFields++;
    if (business.rating !== undefined && business.rating !== null) filledFields++;
    if (business.reviewCount !== undefined && business.reviewCount !== null) filledFields++;
    if (business.location?.lat !== undefined && business.location?.lng !== undefined) filledFields++;

    const dataCompleteness = Math.round((filledFields / totalFields) * 100);

    return {
      sourceCount: business.sourceProviders?.length || business.sources.length || 1,
      dataCompleteness,
      hasWebsite: business.website ? true : 'UNKNOWN',
      hasPhone: business.phone ? true : 'UNKNOWN',
      hasRating: (business.rating !== undefined && business.rating !== null) ? true : 'UNKNOWN',
      hasReviewCount: (business.reviewCount !== undefined && business.reviewCount !== null) ? true : 'UNKNOWN',
    };
  }

  private findMatchKey(business: Business, seen: Map<string, Business>): string | null {
    if (business.providerIds) {
      for (const [provider, id] of Object.entries(business.providerIds)) {
        const key = `pid:${provider}:${id}`;
        if (seen.has(key)) return key;
      }
    }

    if (business.phone) {
      const key = `phone:${this.normalizePhone(business.phone)}`;
      if (seen.has(key)) return key;
    }

    if (business.website) {
      const key = `domain:${this.normalizeDomain(business.website)}`;
      if (seen.has(key)) return key;
    }

    return null;
  }

  private mergeBusinesses(base: Business, duplicate: Business) {
    if (!base.phone && duplicate.phone) base.phone = duplicate.phone;
    if (!base.website && duplicate.website) base.website = duplicate.website;
    if (!base.rating && duplicate.rating) base.rating = duplicate.rating;
    if (!base.reviewCount && duplicate.reviewCount) base.reviewCount = duplicate.reviewCount;

    if (!base.location && duplicate.location) {
      base.location = duplicate.location;
    } else if (base.location && duplicate.location) {
      if (!base.location.address && duplicate.location.address) base.location.address = duplicate.location.address;
      if (!base.location.city && duplicate.location.city) base.location.city = duplicate.location.city;
      if (!base.location.state && duplicate.location.state) base.location.state = duplicate.location.state;
      if (!base.location.zip && duplicate.location.zip) base.location.zip = duplicate.location.zip;
    }

    base.sources = Array.from(new Set([...base.sources, ...duplicate.sources]));
    base.sourceProviders = Array.from(new Set([...(base.sourceProviders || []), ...(duplicate.sourceProviders || [])]));
    base.categories = Array.from(new Set([...(base.categories || []), ...(duplicate.categories || [])]));

    base.providerIds = { ...base.providerIds, ...duplicate.providerIds };
  }

  private normalizePhone(phone: string): string {
    return phone.replace(/\D/g, '');
  }

  private normalizeDomain(url: string): string {
    try {
      let domain = url.replace(/^https?:\/\//, '').replace(/^www\./, '');
      const slashIndex = domain.indexOf('/');
      if (slashIndex !== -1) domain = domain.substring(0, slashIndex);
      return domain.toLowerCase();
    } catch {
      return url.toLowerCase();
    }
  }
}

export const deduplicationService = new DeduplicationService();
