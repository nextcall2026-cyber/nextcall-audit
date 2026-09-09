import { describe, it, expect, beforeEach } from 'vitest';
import { QuotaService } from '@/services/quotaService';
import { ProviderConfig } from '@/types';

const mockConfig: ProviderConfig = {
  name: 'SERPAPI',
  enabled: true,
  priority: 1,
  dailyLimit: 5,
  monthlyLimit: 100,
  usageUnit: 'REQUEST'
};

describe('QuotaService', () => {
  let service: QuotaService;

  beforeEach(() => {
    service = new QuotaService();
  });

  it('should be AVAILABLE initially', () => {
    expect(service.getStatus(mockConfig)).toBe('AVAILABLE');
  });

  it('should block consumption when daily limit is reached', () => {
    service.recordUsage(mockConfig, 5);
    expect(service.getStatus(mockConfig)).toBe('DAILY_LIMIT_REACHED');
    expect(service.canConsume(mockConfig, 1)).toBe(false);
  });

  it('should mark provider as RATE_LIMITED', () => {
    service.markRateLimited('SERPAPI', 5000);
    expect(service.getStatus(mockConfig)).toBe('RATE_LIMITED');
    expect(service.canConsume(mockConfig, 1)).toBe(false);
  });

  it('should return UNCONFIGURED if disabled', () => {
    const disabledConfig = { ...mockConfig, enabled: false };
    expect(service.getStatus(disabledConfig)).toBe('UNCONFIGURED');
  });
});
