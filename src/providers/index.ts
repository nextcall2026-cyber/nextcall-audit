import "server-only";
import { BusinessDiscoveryParams, ProviderConfig, ProviderDiscoveryResult } from "@/types";
import { ProviderError, RateLimitError, getErrorMessage } from "@/lib/errors";

export abstract class BusinessDiscoveryProvider {
  abstract readonly name: ProviderConfig['name'];
  abstract readonly config: ProviderConfig;

  /**
   * Determines if the provider has the necessary credentials/configuration
   * to be used.
   */
  abstract isConfigured(): boolean;

  /**
   * Searches for businesses based on the provided parameters.
   * Must be implemented by concrete providers (SerpApi, Apify, TomTom, Geoapify, etc.)
   * Returns a normalized ProviderDiscoveryResult including usage data.
   */
  abstract discoverBusinesses(params: BusinessDiscoveryParams): Promise<ProviderDiscoveryResult>;

  /**
   * Helper to wrap provider calls and handle standard API errors.
   */
  protected async handleProviderCall<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      // Preserve typed errors so the orchestrator can distinguish them
      if (error instanceof RateLimitError || error instanceof ProviderError) {
        throw error;
      }
      // Detect common rate limit / quota errors
      const responseStatus = (error as { response?: { status?: number } } | null)?.response?.status;
      if (responseStatus === 429) {
        throw new RateLimitError(
          `${this.name} rate limit exceeded.`,
          this.name
        );
      }
      
      throw new ProviderError(
        `${this.name} failed: ${getErrorMessage(error)}`,
        this.name
      );
    }
  }
}
