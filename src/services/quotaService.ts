import "server-only";
import { DiscoveryProviderName, ProviderConfig, ProviderQuotaStatus } from "@/types";
import { logger } from "@/lib/logger";

interface UsageState {
  dailyUsage: number;
  monthlyUsage: number;
  lastDailyReset: string;
  lastMonthlyReset: string;
  rateLimitedUntil: number | null;
}

export class QuotaService {
  private store = new Map<DiscoveryProviderName, UsageState>();

  private getState(provider: DiscoveryProviderName): UsageState {
    if (!this.store.has(provider)) {
      const now = new Date();
      this.store.set(provider, {
        dailyUsage: 0,
        monthlyUsage: 0,
        lastDailyReset: now.toISOString().split('T')[0],
        lastMonthlyReset: now.toISOString().slice(0, 7),
        rateLimitedUntil: null,
      });
    }
    return this.store.get(provider)!;
  }

  private resetIfNeeded(state: UsageState) {
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const thisMonth = now.toISOString().slice(0, 7);

    if (state.lastDailyReset !== today) {
      state.dailyUsage = 0;
      state.lastDailyReset = today;
    }
    if (state.lastMonthlyReset !== thisMonth) {
      state.monthlyUsage = 0;
      state.lastMonthlyReset = thisMonth;
    }
  }

  getStatus(config: ProviderConfig): ProviderQuotaStatus {
    if (!config.enabled) return 'UNCONFIGURED';
    
    const state = this.getState(config.name);
    this.resetIfNeeded(state);

    if (state.rateLimitedUntil && Date.now() < state.rateLimitedUntil) {
      return 'RATE_LIMITED';
    }
    if (config.dailyLimit && state.dailyUsage >= config.dailyLimit) {
      return 'DAILY_LIMIT_REACHED';
    }
    if (config.monthlyLimit && state.monthlyUsage >= config.monthlyLimit) {
      return 'MONTHLY_LIMIT_REACHED';
    }

    return 'AVAILABLE';
  }

  canConsume(config: ProviderConfig, amount: number = 1): boolean {
    if (this.getStatus(config) !== 'AVAILABLE') return false;

    const state = this.getState(config.name);
    const newDaily = state.dailyUsage + amount;
    const newMonthly = state.monthlyUsage + amount;

    if (config.dailyLimit && newDaily > config.dailyLimit) return false;
    if (config.monthlyLimit && newMonthly > config.monthlyLimit) return false;

    return true;
  }

  recordUsage(config: ProviderConfig, amount: number = 1) {
    const state = this.getState(config.name);
    this.resetIfNeeded(state);
    
    state.dailyUsage += amount;
    state.monthlyUsage += amount;
    
    logger.debug(`[QuotaService] Recorded ${amount} usage for ${config.name}. Daily: ${state.dailyUsage}/${config.dailyLimit || '∞'}`);
  }

  markRateLimited(provider: DiscoveryProviderName, durationMs: number = 300000) {
    const state = this.getState(provider);
    state.rateLimitedUntil = Date.now() + durationMs;
    logger.warn(`[QuotaService] ${provider} marked as RATE_LIMITED for ${durationMs / 1000}s.`);
  }

  getRemainingQuota(config: ProviderConfig): { daily: number | null; monthly: number | null } {
    const state = this.getState(config.name);
    this.resetIfNeeded(state);
    return {
      daily: config.dailyLimit ? Math.max(0, config.dailyLimit - state.dailyUsage) : null,
      monthly: config.monthlyLimit ? Math.max(0, config.monthlyLimit - state.monthlyUsage) : null,
    };
  }
}

export const quotaService = new QuotaService();
