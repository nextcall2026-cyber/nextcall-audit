import { describe, it, expect, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { outreachSafetyService } from '@/services/outreachSafetyService';
import { Prospect } from '@/types';

const createMockProspect = (overrides: Partial<Prospect> = {}): Prospect => ({
  id: 'p1',
  businessId: 'b1',
  pipelineStatus: 'NEW',
  outreachState: 'INITIAL_SENT',
  priorityScore: 50,
  priorityLevel: 'HIGH',
  priorityBreakdown: null,
  contactEmail: 'test@example.com',
  lastContactedAt: null,
  nextFollowUpAt: null,
  notes: [],
  isSuppressed: false,
  suppressionReason: null,
  createdAt: '',
  updatedAt: '',
  ...overrides,
});

describe('outreachSafetyService', () => {
  it('should block sending if prospect is suppressed', () => {
    const prospect = createMockProspect({ isSuppressed: true });
    expect(() => outreachSafetyService.validateSend(prospect, 1)).toThrow();
  });

  it('should block sending if prospect is in a terminal state (e.g., BOUNCED)', () => {
    const prospect = createMockProspect({ outreachState: 'BOUNCED' });
    expect(() => outreachSafetyService.validateSend(prospect, 1)).toThrow();
  });

  it('should block sending if sequence state does not match requested stage', () => {
    const prospect = createMockProspect({ outreachState: 'FOLLOW_UP_1_SENT' });
    expect(() => outreachSafetyService.validateSend(prospect, 1)).toThrow();
  });

  it('should allow sending if all conditions are met', () => {
    const prospect = createMockProspect({ outreachState: 'INITIAL_SENT' });
    expect(() => outreachSafetyService.validateSend(prospect, 1)).not.toThrow();
  });

  it('should block sending if email is missing', () => {
    const prospect = createMockProspect({ contactEmail: null });
    expect(() => outreachSafetyService.validateSend(prospect, 1)).toThrow();
  });

  it('should generate correct idempotency key', () => {
    const key = outreachSafetyService.generateIdempotencyKey('prospect-123', 2);
    expect(key).toBe('prospect_prospect-123_stage_2');
  });
});
