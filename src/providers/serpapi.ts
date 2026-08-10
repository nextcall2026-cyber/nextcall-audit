import "server-only";
import { Business, BusinessDiscoveryParams, BoundingBox, ProviderConfig, ProviderDiscoveryResult, DiscoveryProviderName } from "@/types";
import { BusinessDiscoveryProvider } from "@/providers/index";
import { env } from "@/lib/env";
import { ProviderError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";

export class SerpApiProvider extends BusinessDiscoveryProvider {
  readonly name: DiscoveryProviderName = "SERPAPI";
  readonly config: ProviderConfig = {
    name: "SERPAPI",
    enabled: !!env.SERPAPI_API_KEY,
    priority: 1,
    dailyLimit: 100,
    maxResultsPerRequest: 50,
    usageUnit: "REQUEST"
  };

  private readonly apiUrl = "https://serpapi.com/search";

  isConfigured(): boolean {
    return !!env.SERPAPI_API_KEY;
  }

  async discoverBusinesses(params: BusinessDiscoveryParams): Promise<ProviderDiscoveryResult> {
    if (!this.isConfigured()) {
      throw new ProviderError("SerpApi API key is not configured.", this.name);
    }

    const { lat, lng } = this.boundingBoxToCenter(params.boundingBox);

    const requestParams = new URLSearchParams({
      engine: "google_maps",
      q: params.query,
      ll: `@${lat},${lng},15z`,
      type: "search",
      api_key: env.SERPAPI_API_KEY!,
    });

    return this.handleProviderCall(async () => {
      logger.debug(`[${this.name}] Fetching businesses for: ${params.query}`);

      const response = await fetch(`${this.apiUrl}?${requestParams.toString()}`, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new ProviderError(
          `SerpApi request failed with status ${response.status}: ${errorBody}`,
          this.name
        );
      }

      const data = await response.json();
      const rawBusinesses = data.local_results || [];

      const businesses = this.normalizeBusinesses(rawBusinesses);

      return {
        businesses,
        usageAmount: 1,
        usageUnit: "REQUEST"
      };
    });
  }

  private normalizeBusinesses(rawBusinesses: any[]): Business[] {
    return rawBusinesses.map((raw) => {
      const business: Business = {
        id: randomUUID(),
        name: raw.title || "Unknown",
        phone: raw.phone,
        website: raw.website,
        location: {
          lat: raw.latitude,
          lng: raw.longitude,
          address: raw.address,
        },
        rating: raw.rating,
        reviewCount: raw.reviews,
        categories: raw.type ? [raw.type] : [],
        providerIds: { serpapi: raw.place_id || raw.fid || randomUUID() },
        providerUrl: raw.place_id ? `https://www.google.com/maps/place/?q=place_id:${raw.place_id}` : undefined,
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

  private boundingBoxToCenter(box: BoundingBox): { lat: number; lng: number } {
    const lat = (box.minLat + box.maxLat) / 2;
    const lng = (box.minLng + box.maxLng) / 2;
    return { lat, lng };
  }
}
