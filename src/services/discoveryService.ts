import "server-only";
import { Business, BusinessDiscoveryParams, ProviderConfig, DiscoveryProviderName } from "@/types";
import { BusinessDiscoveryProvider } from "@/providers/index";
import { getProviderConfigs } from "@/providers/registry";
import { QuotaService } from "@/services/quotaService";
import { GeoapifyProvider } from "@/providers/geoapify";
import { SerpApiProvider } from "@/providers/serpapi";
import { ApifyProvider } from "@/providers/apify";
import { TomTomProvider } from "@/providers/tomtom";
import { logger } from "@/lib/logger";
import { RateLimitError, ProviderError } from "@/lib/errors";
import { deduplicationService } from "@/services/deduplicationService";

export class DiscoveryOrchestrator {
  private quotaService: QuotaService;

  constructor() {
    this.quotaService = new QuotaService();
  }

  private getProviderInstance(name: DiscoveryProviderName): BusinessDiscoveryProvider {
    switch (name) {
      case "SERPAPI": return new SerpApiProvider();
      case "APIFY": return new ApifyProvider();
      case "TOMTOM": return new TomTomProvider();
      case "GEOAPIFY": return new GeoapifyProvider();
      default: throw new Error(`Unknown provider: ${name}`);
    }
  }

  async discoverBusinesses(
    params: BusinessDiscoveryParams,
    targetResults: number = 50
  ): Promise<Business[]> {
    const activeConfigs = getProviderConfigs();

    if (activeConfigs.length === 0) {
      throw new Error("No business discovery providers are configured. Please add API keys to your .env.local file.");
    }

    const collectedBusinesses: Business[] = [];
    const errors: string[] = [];

    for (const config of activeConfigs) {
      if (collectedBusinesses.length >= targetResults) {
        logger.info(`[Orchestrator] Target reached (${targetResults}). Stopping provider execution.`);
        break;
      }

      const status = this.quotaService.getStatus(config);
      if (status !== 'AVAILABLE') {
        logger.info(`[Orchestrator] Skipping ${config.name}: Status is ${status}.`);
        errors.push(`${config.name}: ${status}`);
        continue;
      }

      if (!this.quotaService.canConsume(config, 1)) {
        logger.info(`[Orchestrator] Skipping ${config.name}: Cannot consume more quota.`);
        continue;
      }

      try {
        const provider = this.getProviderInstance(config.name);
        logger.info(`[Orchestrator] Attempting discovery with ${config.name}...`);

        const result = await provider.discoverBusinesses(params);

        this.quotaService.recordUsage(config, result.usageAmount);

        collectedBusinesses.push(...result.businesses);
        logger.info(`[Orchestrator] ${config.name} returned ${result.businesses.length} businesses. Total collected: ${collectedBusinesses.length}.`);

      } catch (error: any) {
        if (error instanceof RateLimitError) {
          logger.warn(`[Orchestrator] ${config.name} rate limit exceeded. Marking provider.`);
          this.quotaService.markRateLimited(config.name);
          errors.push(`${config.name}: Rate limit exceeded`);
        } else if (error instanceof ProviderError) {
          logger.warn(`[Orchestrator] ${config.name} failed: ${error.message}. Falling back...`);
          errors.push(`${config.name}: ${error.message}`);
        } else {
          logger.error(`[Orchestrator] Unexpected error with ${config.name}:`, error.message);
          errors.push(`${config.name}: Unexpected error`);
        }
      }
    }

    if (collectedBusinesses.length === 0) {
      throw new Error(`All discovery providers failed or returned zero results. Errors: ${errors.join(" | ")}`);
    }

    const uniqueBusinesses = deduplicationService.deduplicate(collectedBusinesses);

    return uniqueBusinesses;
  }

  getProviderHealthSummary() {
    const allConfigs = getProviderConfigs();
    return allConfigs.map(config => {
      const status = this.quotaService.getStatus(config);
      const remaining = this.quotaService.getRemainingQuota(config);
      return {
        name: config.name,
        priority: config.priority,
        enabled: config.enabled,
        status,
        remainingDaily: remaining.daily,
        remainingMonthly: remaining.monthly,
      };
    });
  }
}

export const discoveryService = new DiscoveryOrchestrator();
