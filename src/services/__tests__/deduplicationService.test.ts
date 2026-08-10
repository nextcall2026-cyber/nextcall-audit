import { describe, it, expect } from 'vitest';
import { deduplicationService } from '@/services/deduplicationService';
import { Business } from '@/types';

const createMockBusiness = (overrides: Partial<Business> = {}): Business => ({
  id: '1',
  name: 'Test Business',
  phone: '+1234567890',
  website: 'https://test.com',
  location: { lat: 0, lng: 0, address: '123 Main' },
  rating: 4.5,
  reviewCount: 100,
  categories: ['Plumber'],
  providerIds: { geoapify: 'geoapify-1' },
  sources: ['GEOAPIFY'],
  sourceProviders: ['GEOAPIFY'],
  ...overrides,
});

describe('deduplicationService', () => {
  it('should merge businesses with the same phone number', () => {
    const biz1 = createMockBusiness({ id: '1', phone: '+1234567890', sourceProviders: ['GEOAPIFY'] });
    const biz2 = createMockBusiness({ id: '2', phone: '+1234567890', sourceProviders: ['TOMTOM'] });

    const result = deduplicationService.deduplicate([biz1, biz2]);
    expect(result.length).toBe(1);
    expect(result[0].sourceProviders?.length).toBe(2);
  });

  it('should merge businesses with the same website domain', () => {
    const biz1 = createMockBusiness({ id: '1', phone: '111', website: 'https://test.com', sourceProviders: ['GEOAPIFY'] });
    const biz2 = createMockBusiness({ id: '2', phone: '222', website: 'http://www.test.com/', sourceProviders: ['TOMTOM'] });

    const result = deduplicationService.deduplicate([biz1, biz2]);
    expect(result.length).toBe(1);
  });

  it('should NOT merge businesses with different phones and websites', () => {
    const biz1 = createMockBusiness({ id: '1', phone: '111', website: 'https://test1.com', providerIds: { geoapify: 'geoapify-1' } });
    const biz2 = createMockBusiness({ id: '2', phone: '222', website: 'https://test2.com', providerIds: { geoapify: 'geoapify-2' } });

    const result = deduplicationService.deduplicate([biz1, biz2]);
    expect(result.length).toBe(2);
  });

  it('should fill missing data from the duplicate', () => {
    const biz1 = createMockBusiness({ id: '1', phone: '+1234567890', rating: undefined, reviewCount: undefined });
    const biz2 = createMockBusiness({ id: '2', phone: '+1234567890', rating: 4.0, reviewCount: 50 });

    const result = deduplicationService.deduplicate([biz1, biz2]);
    expect(result.length).toBe(1);
    expect(result[0].rating).toBe(4.0);
    expect(result[0].reviewCount).toBe(50);
  });

  it('should calculate discovery quality signals correctly', () => {
    const biz1 = createMockBusiness({ sourceProviders: ['GEOAPIFY', 'TOMTOM'] });
    const result = deduplicationService.deduplicate([biz1]);
    expect(result[0].discoverySignals?.sourceCount).toBe(2);
    expect(result[0].discoverySignals?.dataCompleteness).toBe(100);
    expect(result[0].discoverySignals?.hasWebsite).toBe(true);
  });
});
