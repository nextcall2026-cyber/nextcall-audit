import "server-only";
import { ProviderConfig } from "@/types";
import { env } from "@/lib/env";

export function getProviderConfigs(): ProviderConfig[] {
  const configs: ProviderConfig[] = [];

  configs.push({
    name: "SERPAPI",
    enabled: !!env.SERPAPI_API_KEY,
    priority: 1,
    dailyLimit: env.SERPAPI_MAX_DISCOVERY_RESULTS,
    maxResultsPerRequest: 50,
    usageUnit: "REQUEST"
  });

  configs.push({
    name: "APIFY",
    enabled: !!env.APIFY_API_TOKEN && !!env.APIFY_ACTOR_ID,
    priority: 2,
    dailyLimit: env.APIFY_MAX_DISCOVERY_RESULTS,
    maxResultsPerRequest: 50,
    usageUnit: "ACTOR_RUN"
  });

  configs.push({
    name: "TOMTOM",
    enabled: !!env.TOMTOM_API_KEY,
    priority: 3,
    dailyLimit: env.TOMTOM_MAX_REQUESTS_PER_DAY,
    maxResultsPerRequest: 100,
    usageUnit: "REQUEST"
  });

  configs.push({
    name: "GEOAPIFY",
    enabled: !!env.GEOAPIFY_API_KEY,
    priority: 4,
    dailyLimit: env.GEOAPIFY_MAX_REQUESTS_PER_DAY,
    maxResultsPerRequest: 20,
    usageUnit: "REQUEST"
  });

  return configs.filter(c => c.enabled).sort((a, b) => a.priority - b.priority);
}
