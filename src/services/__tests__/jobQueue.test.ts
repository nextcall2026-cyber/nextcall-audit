import { describe, it, expect, vi, beforeEach } from 'vitest';

const memory = vi.hoisted(() => {
  const stores = new Map<string, Map<string, Record<string, unknown>>>();
  return { stores };
});

vi.mock('@/lib/db', async () => {
  const { getMemoryDb } = await import('@/lib/memoryDb');
  return {
    getAuditJobsCollection: async () => getMemoryDb().collection('audit_jobs'),
  };
});

import { jobQueueService, MAX_ATTEMPTS, STALE_LOCK_MS } from '@/services/jobQueueService';
import { getMemoryDb } from '@/lib/memoryDb';

const collection = () => getMemoryDb().collection('audit_jobs') as unknown as {
  find: (f: Record<string, unknown>) => { toArray: () => Promise<Record<string, unknown>[]> };
  findOne: (f: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  updateOne: (f: Record<string, unknown>, u: Record<string, unknown>) => Promise<unknown>;
  deleteMany: (f: Record<string, unknown>) => Promise<unknown>;
};

describe('jobQueueService', () => {
  beforeEach(async () => {
    memory.stores.clear();
    await collection().deleteMany({});
  });

  it('queues a job ready to run immediately', async () => {
    const job = await jobQueueService.enqueue({ businessId: 'b1', businessName: 'Mossy Stone' });

    expect(job).not.toBeNull();
    expect(job!.status).toBe('QUEUED');
    expect(job!.attempts).toBe(0);
    expect(job!.businessName).toBe('Mossy Stone');
  });

  it('does not queue the same business twice', async () => {
    const first = await jobQueueService.enqueue({ businessId: 'b1', businessName: 'Mossy Stone' });
    const second = await jobQueueService.enqueue({ businessId: 'b1', businessName: 'Mossy Stone' });

    expect(second!.id).toBe(first!.id);
    const all = await collection().find({}).toArray();
    expect(all).toHaveLength(1);
  });

  it('hands a job to exactly one worker', async () => {
    await jobQueueService.enqueue({ businessId: 'b1', businessName: 'Mossy Stone' });

    const first = await jobQueueService.claimNext('worker-1');
    const second = await jobQueueService.claimNext('worker-2');

    expect(first).not.toBeNull();
    expect(first!.status).toBe('RUNNING');
    expect(first!.workerId).toBe('worker-1');
    expect(second).toBeNull();
  });

  it('marks a claimed job done', async () => {
    const job = await jobQueueService.enqueue({ businessId: 'b1', businessName: 'Mossy Stone' });
    await jobQueueService.claimNext('worker-1');
    await jobQueueService.complete(job!.id);

    const stored = await collection().findOne({ id: job!.id });
    expect(stored!.status).toBe('DONE');
    expect(stored!.finishedAt).toBeTruthy();
  });

  it('retries a failure after a delay instead of losing it', async () => {
    const job = await jobQueueService.enqueue({ businessId: 'b1', businessName: 'Mossy Stone' });
    const claimed = await jobQueueService.claimNext('worker-1');

    const status = await jobQueueService.fail(claimed!, 'The website could not be read.', 'ENRICHMENT_FAILED');

    expect(status).toBe('QUEUED');
    const stored = await collection().findOne({ id: job!.id });
    expect(stored!.attempts).toBe(1);
    expect(stored!.lastError).toBe('The website could not be read.');
    expect(new Date(String(stored!.nextAttemptAt)).getTime()).toBeGreaterThan(Date.now());

    // Too early: the retry delay has not elapsed.
    expect(await jobQueueService.claimNext('worker-2')).toBeNull();
  });

  it('parks the job as DEAD after the last attempt', async () => {
    const job = await jobQueueService.enqueue({ businessId: 'b1', businessName: 'Mossy Stone' });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      // Pretend the retry delay has passed.
      await collection().updateOne(
        { id: job!.id },
        { $set: { nextAttemptAt: new Date(Date.now() - 1000).toISOString(), status: 'QUEUED' } }
      );

      const claimed = await jobQueueService.claimNext(`worker-${attempt}`);
      expect(claimed).not.toBeNull();
      await jobQueueService.fail(claimed!, 'Still failing.', 'AUDIT_FAILED');
    }

    const stored = await collection().findOne({ id: job!.id });
    expect(stored!.status).toBe('DEAD');
    expect(stored!.attempts).toBe(MAX_ATTEMPTS);
  });

  it('reclaims a job whose worker died mid-flight', async () => {
    const job = await jobQueueService.enqueue({ businessId: 'b1', businessName: 'Mossy Stone' });
    await jobQueueService.claimNext('worker-1');

    // Simulate a worker killed long ago.
    await collection().updateOne(
      { id: job!.id },
      { $set: { lockedAt: new Date(Date.now() - STALE_LOCK_MS - 60_000).toISOString() } }
    );

    const requeued = await jobQueueService.requeueStale();
    expect(requeued).toBe(1);

    const stored = await collection().findOne({ id: job!.id });
    expect(stored!.status).toBe('QUEUED');
    expect(stored!.lastErrorCode).toBe('WORKER_LOST');
  });

  it('lets the operator put a DEAD job back in the queue', async () => {
    const job = await jobQueueService.enqueue({ businessId: 'b1', businessName: 'Mossy Stone' });
    await collection().updateOne(
      { id: job!.id },
      { $set: { status: 'DEAD', attempts: 3, lastError: 'gave up' } }
    );

    expect(await jobQueueService.retry(job!.id)).toBe(true);

    const stored = await collection().findOne({ id: job!.id });
    expect(stored!.status).toBe('QUEUED');
    expect(stored!.attempts).toBe(0);
    expect(stored!.lastError).toBeNull();
  });

  it('counts jobs by status', async () => {
    await jobQueueService.enqueue({ businessId: 'b1', businessName: 'One' });
    const two = await jobQueueService.enqueue({ businessId: 'b2', businessName: 'Two' });
    await jobQueueService.claimNext('worker-1');
    await jobQueueService.complete(two!.id);

    const stats = await jobQueueService.stats();
    expect(stats.QUEUED + stats.RUNNING + stats.DONE).toBe(2);
  });
});
