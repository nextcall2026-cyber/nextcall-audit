import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getBusinessById: vi.fn(),
  getLatestAudit: vi.fn(),
  saveAudit: vi.fn(),
  saveAIReport: vi.fn(),
  runAudit: vi.fn(),
  generateAuditReport: vi.fn(),
}));

vi.mock('@/services/persistenceService', () => ({
  persistenceService: { getBusinessById: mocks.getBusinessById },
}));

vi.mock('@/services/auditPersistenceService', () => ({
  auditPersistenceService: {
    getLatestAudit: mocks.getLatestAudit,
    saveAudit: mocks.saveAudit,
    saveAIReport: mocks.saveAIReport,
  },
}));

vi.mock('@/services/auditService', () => ({
  auditEngine: { runAudit: mocks.runAudit },
}));

vi.mock('@/services/aiReportService', () => ({
  aiReportService: { generateAuditReport: mocks.generateAuditReport },
}));

import { auditReadinessService } from '@/services/auditReadinessService';

const business = { id: 'b1', name: 'JL Plumbing' };
const auditResult = { overallScore: 61 };
const storedAudit = { id: 'a1', businessId: 'b1', audit: auditResult, aiReport: null };
const aiReport = { executiveSummary: 'ok' };

describe('AuditReadinessService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBusinessById.mockResolvedValue(business);
  });

  it('builds the missing audit and then the AI report, in that order', async () => {
    mocks.getLatestAudit.mockResolvedValue(null);
    mocks.runAudit.mockResolvedValue(auditResult);
    mocks.saveAudit.mockResolvedValue(storedAudit);
    mocks.generateAuditReport.mockResolvedValue(aiReport);

    const result = await auditReadinessService.ensureReady('b1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdAudit).toBe(true);
    expect(result.generatedReport).toBe(true);
    expect(result.stored.aiReport).toEqual(aiReport);

    expect(mocks.runAudit).toHaveBeenCalledWith(business);
    expect(mocks.generateAuditReport).toHaveBeenCalledWith(business, auditResult);
    expect(mocks.saveAIReport).toHaveBeenCalledWith('a1', aiReport);
  });

  it('only fills in the AI report when the audit already exists', async () => {
    mocks.getLatestAudit.mockResolvedValue(storedAudit);
    mocks.generateAuditReport.mockResolvedValue(aiReport);

    const result = await auditReadinessService.ensureReady('b1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdAudit).toBe(false);
    expect(result.generatedReport).toBe(true);
    expect(mocks.runAudit).not.toHaveBeenCalled();
  });

  it('does no work when the audit is already complete', async () => {
    mocks.getLatestAudit.mockResolvedValue({ ...storedAudit, aiReport });

    const result = await auditReadinessService.ensureReady('b1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.createdAudit).toBe(false);
    expect(result.generatedReport).toBe(false);
    expect(mocks.generateAuditReport).not.toHaveBeenCalled();
  });

  it('refuses to call the model when the caller has no AI budget left', async () => {
    mocks.getLatestAudit.mockResolvedValue(storedAudit);

    const result = await auditReadinessService.ensureReady('b1', { allowAiReport: false });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AI_BUDGET');
    expect(mocks.generateAuditReport).not.toHaveBeenCalled();
  });

  it('reports a failed AI call instead of returning a half-finished audit', async () => {
    mocks.getLatestAudit.mockResolvedValue(storedAudit);
    mocks.generateAuditReport.mockRejectedValue(new Error('model timed out'));

    const result = await auditReadinessService.ensureReady('b1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AI_FAILED');
    expect(result.error).toContain('model timed out');
  });

  it('reports a failed audit save', async () => {
    mocks.getLatestAudit.mockResolvedValue(null);
    mocks.runAudit.mockResolvedValue(auditResult);
    mocks.saveAudit.mockResolvedValue(null);

    const result = await auditReadinessService.ensureReady('b1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('AUDIT_FAILED');
  });

  it('stops when the business no longer exists', async () => {
    mocks.getBusinessById.mockResolvedValue(null);

    const result = await auditReadinessService.ensureReady('b1');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('BUSINESS_MISSING');
  });
});
