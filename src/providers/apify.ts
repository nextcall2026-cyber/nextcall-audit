import "server-only";
import { Business, BusinessDiscoveryParams, BoundingBox, ProviderConfig, ProviderDiscoveryResult, DiscoveryProviderName } from "@/types";
import { BusinessDiscoveryProvider } from "@/providers/index";
import { env } from "@/lib/env";
import { ProviderError, RateLimitError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";

/** Raw dataset-item shape returned by the Apify Google Maps actor. */
interface ApifyRawPlace {
  title?: string;
  name?: string;
  phone?: string;
  website?: string;
  location?: { lat?: number; lng?: number };
  latitude?: number;
  longitude?: number;
  address?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
  totalScore?: number;
  rating?: number;
  reviewsCount?: number;
  reviewCount?: number;
  categories?: string[];
  placeId?: string;
  id?: string;
  url?: string;
  permanentlyClosed?: boolean;
}

export class ApifyProvider extends BusinessDiscoveryProvider {
  readonly name: DiscoveryProviderName = "APIFY";
  readonly config: ProviderConfig = {
    name: "APIFY",
    enabled: !!env.APIFY_API_TOKEN && !!env.APIFY_ACTOR_ID,
    priority: 2,
    dailyLimit: 50,
    maxResultsPerRequest: 50,
    usageUnit: "ACTOR_RUN"
  };

  isConfigured(): boolean {
    return !!env.APIFY_API_TOKEN && !!env.APIFY_ACTOR_ID;
  }

  async discoverBusinesses(params: BusinessDiscoveryParams): Promise<ProviderDiscoveryResult> {
    if (!this.isConfigured()) {
      throw new ProviderError("Apify API token or Actor ID is not configured.", this.name);
    }

    const { lat, lng } = this.boundingBoxToCenter(params.boundingBox);

    const inputPayload = {
      searchStringsArray: [params.query],
      startUrls: [],
      extractionContext: "google_maps_bs4",
      placeLinks: false,
      maxImages: 0,
      language: "en",
      lat,
      lng,
      zoom: 15,
      maxCrawledPlacesPerSearch: this.config.maxResultsPerRequest,
    };

    const url = `https://api.apify.com/v2/acts/${env.APIFY_ACTOR_ID}/run-sync-get-dataset-items?token=${env.APIFY_API_TOKEN}`;

    return this.handleProviderCall(async () => {
      logger.debug(`[${this.name}] Fetching businesses for: ${params.query}`);

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(inputPayload),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new RateLimitError("Apify rate limit exceeded.", this.name);
        }
        const errorBody = await response.text();
        throw new ProviderError(
          `Apify actor failed with status ${response.status}: ${errorBody}`,
          this.name
        );
      }

      const data = await response.json();
      const businesses = this.normalizeBusinesses(data);

      return {
        businesses,
        usageAmount: 1,
        usageUnit: "ACTOR_RUN"
      };
    });
  }

  private normalizeBusinesses(rawBusinesses: ApifyRawPlace[]): Business[] {
    if (!Array.isArray(rawBusinesses)) return [];

    return rawBusinesses.map((raw) => {
      const business: Business = {
        id: randomUUID(),
        name: raw.title || raw.name || "Unknown",
        phone: raw.phone,
        website: raw.website,
        location: {
          lat: raw.location?.lat || raw.latitude,
          lng: raw.location?.lng || raw.longitude,
          address: raw.address,
          city: raw.city,
          state: raw.state,
          zip: raw.postalCode,
          country: raw.country,
        },
        rating: raw.totalScore || raw.rating,
        reviewCount: raw.reviewsCount || raw.reviewCount,
        categories: raw.categories || [],
        providerIds: { apify: raw.placeId || raw.id || randomUUID() },
        providerUrl: raw.url,
        status: raw.permanentlyClosed ? "permanently_closed" : "active",
        sources: [this.name],
        sourceProviders: [this.name],
      };

      if (business.location) {
        Object.keys(business.location).forEach(key => {
          if (business.location![key as keyof typeof business.location] === undefined) {
            delete business.location![key as keyof typeof business.location];
          }
        });
        if (Object.keys(business.location).length === 0) {
          business.location = undefined;
        }
      }

      return business;
    });
  }

  private boundingBoxToCenter(box: BoundingBox): { lat: number; lng: number } {
    const lat = (box.minLat + box.maxLat) / 2;
    const lng = (box.minLng + box.maxLng) / 2;
    return { lat, lng };
  }
}
