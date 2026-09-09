import "server-only";
import { Business, BusinessDiscoveryParams, BoundingBox, ProviderConfig, ProviderDiscoveryResult, DiscoveryProviderName } from "@/types";
import { BusinessDiscoveryProvider } from "@/providers/index";
import { env } from "@/lib/env";
import { ProviderError, RateLimitError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";

/** Raw search-result shape returned by the TomTom Search API. */
interface TomTomRawResult {
  id?: string | number;
  poi?: { name?: string; phone?: string; url?: string; categories?: string[] };
  position?: { lat?: number; lon?: number };
  address?: {
    freeformAddress?: string;
    municipality?: string;
    countrySubdivision?: string;
    postalCode?: string;
    country?: string;
  };
}

export class TomTomProvider extends BusinessDiscoveryProvider {
  readonly name: DiscoveryProviderName = "TOMTOM";
  readonly config: ProviderConfig = {
    name: "TOMTOM",
    enabled: !!env.TOMTOM_API_KEY,
    priority: 4,
    dailyLimit: 2500,
    maxResultsPerRequest: 100,
    usageUnit: "REQUEST"
  };

  isConfigured(): boolean {
    return !!env.TOMTOM_API_KEY;
  }

  async discoverBusinesses(params: BusinessDiscoveryParams): Promise<ProviderDiscoveryResult> {
    if (!this.isConfigured()) {
      throw new ProviderError("TomTom API key is not configured.", this.name);
    }

    const { topLeft, btmRight } = this.boundingBoxToCorners(params.boundingBox);

    const apiUrl = `https://api.tomtom.com/search/2/geometrySearch/${encodeURIComponent(params.query)}.json`;

    const requestParams = new URLSearchParams({
      key: env.TOMTOM_API_KEY!,
      limit: this.config.maxResultsPerRequest!.toString(),
      geometryList: JSON.stringify([{
        type: "POLYGON",
        vertices: [
          topLeft,
          `${params.boundingBox.maxLat},${params.boundingBox.maxLng}`,
          btmRight,
          `${params.boundingBox.minLat},${params.boundingBox.minLng}`,
        ]
      }]),
    });

    return this.handleProviderCall(async () => {
      logger.debug(`[${this.name}] Fetching businesses for: ${params.query}`);

      const response = await fetch(`${apiUrl}?${requestParams.toString()}`, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new RateLimitError("TomTom rate limit exceeded.", this.name);
        }
        const errorBody = await response.text();
        throw new ProviderError(
          `TomTom API request failed with status ${response.status}: ${errorBody}`,
          this.name
        );
      }

      const data = await response.json();
      const rawBusinesses = data.results || [];

      const businesses = this.normalizeBusinesses(rawBusinesses);

      return {
        businesses,
        usageAmount: 1,
        usageUnit: "REQUEST"
      };
    });
  }

  private normalizeBusinesses(rawBusinesses: TomTomRawResult[]): Business[] {
    return rawBusinesses.map((raw) => {
      const business: Business = {
        id: randomUUID(),
        name: raw.poi?.name || "Unknown",
        phone: raw.poi?.phone,
        website: raw.poi?.url,
        location: {
          lat: raw.position?.lat,
          lng: raw.position?.lon,
          address: raw.address?.freeformAddress,
          city: raw.address?.municipality,
          state: raw.address?.countrySubdivision,
          zip: raw.address?.postalCode,
          country: raw.address?.country,
        },
        rating: undefined,
        reviewCount: undefined,
        categories: raw.poi?.categories || [],
        providerIds: { tomtom: raw.id?.toString() || randomUUID() },
        providerUrl: undefined,
        status: "active",
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

  private boundingBoxToCorners(box: BoundingBox): { topLeft: string; btmRight: string } {
    const topLeft = `${box.maxLat},${box.minLng}`;
    const btmRight = `${box.minLat},${box.maxLng}`;
    return { topLeft, btmRight };
  }
}
