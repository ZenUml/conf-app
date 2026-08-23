import { describe, expect, it, vi } from 'vitest';
import { runScheduledJobs } from './index';

describe('daily cron isolation', () => {
  it('keeps analytics aggregation and retention successful when contact refresh fails', async () => {
    const calls: string[] = [];
    const result = await runScheduledJobs(
      { scheduledTime: Date.parse('2026-08-23T02:00:00.000Z') } as ScheduledController,
      { DB: {} as D1Database },
      {
        runAnalyticsMaintenance: vi.fn(async () => { calls.push('analytics'); }),
        refreshMarketplaceContacts: vi.fn(async () => {
          calls.push('contacts');
          throw new Error('fixture Marketplace outage');
        }),
        logError: vi.fn(),
      },
    );

    expect(calls).toEqual(['analytics', 'contacts']);
    expect(result).toEqual({ analytics: 'completed', marketplaceContacts: 'failed' });
  });
});
