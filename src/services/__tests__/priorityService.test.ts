import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { priorityService } from '@/services/priorityService';
import { Business, Prospect } from '@/types';

const createMockProspect = (overrides: Partial<Prospect> = {}): Prospect => ({
  id: 'prospect-1',
  businessId: 'business-1',
  pipelineStatus: 'NEW',
  outreachState: 'UNCONTACTED',
  priorityScore: null,
  priorityLevel: null,
  priorityBreakdown: null,
  contactEmail: 'test@example.com',
  lastContactedAt: null,
  nextFollowUpAt: null,
  notes: [],
  isSuppressed: false,
  suppressionReason: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const createMockBusiness = (overrides: Partial<Business> = {}): Business => ({
  id: 'business-1',
  name: 'Test Plumbing',
  phone: '+1234567890',
  website: 'https://testplumbing.com',
  location: { lat: 0, lng: 0, city: 'Test', state: 'TS' },
  rating: 4.5,
  reviewCount: 120,
  categories: ['Plumber'],
  providerIds: {},
  sources: [],
  enrichment: {
    status: 'COMPLETED',
    website: { url: 'https://testplumbing.com', isReachable: true },
    emails: [{ address: 'test@example.com', type: 'BUSINESS', sourceUrl: 'https://testplumbing.com', sourceType: 'VISIBLE_TEXT', confidence: 80 }],
    booking: { detected: false },
  },
  ...overrides,
});

describe('priorityService', () => {
  it('should score a high-quality, high-opportunity prospect correctly', () => {
    const business = createMockBusiness();
    const prospect = createMockProspect();

    const breakdown = priorityService.calculatePriorityScore(business, prospect);
    const score = priorityService.calculateWeightedScore(breakdown);
    const level = priorityService.getPriorityLevel(score);

    expect(breakdown.contactability).toBe(80);
    expect(breakdown.nextCallFit).toBe(100);
    expect(breakdown.businessMaturity).toBe(100);
    expect(breakdown.outreachReadiness).toBe(100);
    
    expect(score).toBeGreaterThanOrEqual(90);
    expect(level).toBe('HOT');
  });

  it('should penalize missing contact email heavily', () => {
    const business = createMockBusiness({ 
      phone: undefined, 
      enrichment: { 
        status: 'COMPLETED', 
        website: { url: 'https://testplumbing.com', isReachable: true },
        emails: [], 
        booking: { detected: false } 
      } 
    });
    const prospect = createMockProspect({ contactEmail: null });

    const breakdown = priorityService.calculatePriorityScore(business, prospect);
    
    expect(breakdown.contactability).toBe(0);
    expect(breakdown.outreachReadiness).toBe(50);
  });

  it('should zero out outreach readiness if suppressed', () => {
    const business = createMockBusiness();
    const prospect = createMockProspect({ isSuppressed: true });

    const breakdown = priorityService.calculatePriorityScore(business, prospect);
    
    expect(breakdown.outreachReadiness).toBe(0);
    expect(breakdown.reasons).toContain('Prospect is suppressed (Do not contact)');
  });
});
