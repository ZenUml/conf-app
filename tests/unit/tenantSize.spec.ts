import { describe, it, expect, vi } from 'vitest';
import {
  computeTenantSizeEstimate,
  getCachedTenantSize,
  setCachedTenantSize,
  loadTenantSizeInputs,
  TenantSizeEstimate,
} from '../../functions/utils/tenantSize';

class MockKV {
  store = new Map<string, string>();
  get = vi.fn(async (k: string) => this.store.get(k) ?? null);
  put = vi.fn(async (k: string, v: string, _opts?: { expirationTtl?: number }) => {
    this.store.set(k, v);
  });
}

describe('computeTenantSizeEstimate', () => {
  it('returns "unknown" when install is younger than 30 days', () => {
    const r = computeTenantSizeEstimate({ installAgeDays: 7, uniqueViewerCount30d: 50 });
    expect(r).toBe<TenantSizeEstimate>('unknown');
  });

  it('returns "unknown" when fewer than 3 distinct viewers observed', () => {
    expect(computeTenantSizeEstimate({ installAgeDays: 90, uniqueViewerCount30d: 0 })).toBe('unknown');
    expect(computeTenantSizeEstimate({ installAgeDays: 90, uniqueViewerCount30d: 2 })).toBe('unknown');
  });

  it('returns "small_likely" with 30+ days and ≤8 viewers', () => {
    expect(computeTenantSizeEstimate({ installAgeDays: 30, uniqueViewerCount30d: 3 })).toBe('small_likely');
    expect(computeTenantSizeEstimate({ installAgeDays: 30, uniqueViewerCount30d: 8 })).toBe('small_likely');
  });

  it('returns "medium_or_larger" with 30+ days and ≥9 viewers', () => {
    expect(computeTenantSizeEstimate({ installAgeDays: 30, uniqueViewerCount30d: 9 })).toBe('medium_or_larger');
    expect(computeTenantSizeEstimate({ installAgeDays: 365, uniqueViewerCount30d: 5000 })).toBe('medium_or_larger');
  });
});

describe('getCachedTenantSize / setCachedTenantSize', () => {
  it('returns null on cache miss', async () => {
    const kv = new MockKV();
    expect(await getCachedTenantSize(kv as any, 'cloud-1')).toBeNull();
  });

  it('round-trips via set then get', async () => {
    const kv = new MockKV();
    await setCachedTenantSize(kv as any, 'cloud-1', 'small_likely');
    expect(await getCachedTenantSize(kv as any, 'cloud-1')).toBe('small_likely');
    expect(kv.put).toHaveBeenCalledWith('tenant_size:cloud-1', 'small_likely', { expirationTtl: 86400 });
  });

  it('ignores corrupt cache values', async () => {
    const kv = new MockKV();
    kv.store.set('tenant_size:cloud-1', 'definitely-not-an-enum');
    expect(await getCachedTenantSize(kv as any, 'cloud-1')).toBeNull();
  });
});

describe('loadTenantSizeInputs', () => {
  it('returns zeros when DB binding is absent', async () => {
    const result = await loadTenantSizeInputs({}, 'cloud-1');
    expect(result).toEqual({ installAgeDays: 0, uniqueViewerCount30d: 0 });
  });

  it('queries UserBehaviorEvent for unique view_macro users in last 30d', async () => {
    const dbCalls: Array<{ sql: string; binds: any[] }> = [];
    const mockDb = {
      prepare: (sql: string) => {
        const stmt = {
          bind: (...binds: any[]) => {
            dbCalls.push({ sql, binds });
            return {
              first: vi.fn(async <T>() => {
                if (sql.includes('UserBehaviorEvent') && sql.includes('view_macro')) {
                  return { n: 17 } as T;
                }
                if (sql.includes('ForgeInstallation') || sql.includes('MIN(createdAt)')) {
                  // Install age proxy: 45 days ago
                  const fortyFiveDaysAgo = new Date(Date.now() - 45 * 86_400_000).toISOString();
                  return { installed_at: fortyFiveDaysAgo, oldest: fortyFiveDaysAgo } as T;
                }
                return null;
              }),
            };
          },
        };
        return stmt;
      },
    } as any;

    const result = await loadTenantSizeInputs({ DB: mockDb }, 'cloud-1');
    expect(result.uniqueViewerCount30d).toBe(17);
    expect(result.installAgeDays).toBeGreaterThanOrEqual(44);
    expect(result.installAgeDays).toBeLessThanOrEqual(46);
    expect(dbCalls.some((c) => c.sql.includes('UserBehaviorEvent'))).toBe(true);
  });

  it('returns zeros gracefully on D1 errors', async () => {
    const mockDb = {
      prepare: () => ({ bind: () => ({ first: async () => { throw new Error('boom'); } }) }),
    } as any;
    const result = await loadTenantSizeInputs({ DB: mockDb }, 'cloud-1');
    expect(result).toEqual({ installAgeDays: 0, uniqueViewerCount30d: 0 });
  });
});
