import "server-only";
import { Business, BusinessDiscoveryParams, BoundingBox, ProviderConfig, ProviderDiscoveryResult, DiscoveryProviderName } from "@/types";
import { BusinessDiscoveryProvider } from "@/providers/index";
import { env } from "@/lib/env";
import { ProviderError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { randomUUID } from "crypto";

/** Raw GeoJSON feature shape returned by the Geoapify Places API. */
interface GeoapifyFeature {
  properties?: {
    name?: string;
    phone?: string;
    website?: string;
    address_line1?: string;
    city?: string;
    state?: string;
    postcode?: string;
    country?: string;
    categories?: string;
    place_id?: string;
    datasource?: { url?: string; raw?: { osm_id?: string | number } };
  };
  geometry?: { coordinates?: number[] };
}

export class GeoapifyProvider extends BusinessDiscoveryProvider {
  readonly name: DiscoveryProviderName = "GEOAPIFY";
  readonly config: ProviderConfig = {
    name: "GEOAPIFY",
    enabled: !!env.GEOAPIFY_API_KEY,
    priority: 5,
    dailyLimit: 3000,
    maxResultsPerRequest: 20,
    usageUnit: "REQUEST"
  };

  private readonly apiUrl = "https://api.geoapify.com/v2/places";

  isConfigured(): boolean {
    return !!env.GEOAPIFY_API_KEY;
  }

  async discoverBusinesses(params: BusinessDiscoveryParams): Promise<ProviderDiscoveryResult> {
    if (!this.isConfigured()) {
      throw new ProviderError("Geoapify API key is not configured.", this.name);
    }

    const rect = this.boundingBoxToRect(params.boundingBox);

    const requestParams = new URLSearchParams({
      categories: "commercial",
      filter: `rect:${rect.minLng},${rect.minLat},${rect.maxLng},${rect.maxLat}`,
      limit: this.config.maxResultsPerRequest!.toString(),
      apiKey: env.GEOAPIFY_API_KEY!,
    });

    if (params.query) {
      requestParams.append("name", params.query);
    }

    return this.handleProviderCall(async () => {
      logger.debug(`[${this.name}] Fetching businesses for: ${params.query}`);

      const response = await fetch(`${this.apiUrl}?${requestParams.toString()}`, {
        headers: { Accept: "application/json" },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new ProviderError(
          `Geoapify API request failed with status ${response.status}: ${errorBody}`,
          this.name
        );
      }

      const data = await response.json();
      const businesses = this.normalizeBusinesses(data.features || []);

      return {
        businesses,
        usageAmount: 1,
        usageUnit: "REQUEST"
      };
    });
  }

  private normalizeBusinesses(features: GeoapifyFeature[]): Business[] {
    return features.map((feature) => {
      const raw = feature.properties || {};
      const coords = feature.geometry?.coordinates || [];

      const business: Business = {
        id: randomUUID(),
        name: raw.name || "Unknown",
        phone: raw.phone,
        website: raw.website,
        location: {
          lat: coords[1],
          lng: coords[0],
          address: raw.address_line1,
          city: raw.city,
          state: raw.state,
          zip: raw.postcode,
          country: raw.country,
        },
        rating: undefined,
        reviewCount: undefined,
        categories: raw.categories?.split(",") || [],
        providerIds: { geoapify: raw.place_id || String(raw.datasource?.raw?.osm_id ?? "") },
        providerUrl: raw.datasource?.url,
        status: raw.state === "closed" ? "permanently_closed" : "active",
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

  private boundingBoxToRect(box: BoundingBox) {
    return {
      minLng: box.minLng,
      minLat: box.minLat,
      maxLng: box.maxLng,
      maxLat: box.maxLat,
    };
  }
}
