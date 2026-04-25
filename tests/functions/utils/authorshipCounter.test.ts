import { describe, it, expect, vi } from 'vitest';
import {
  hashAccountId,
  incrementAuthorship,
  getPersonalAuthored,
} from '../../../functions/utils/authorshipCounter';

function makeKV() {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> };
}

describe('hashAccountId', () => {
  it('produces a stable 64-char hex digest', async () => {
    const a = await hashAccountId('user-123');
    const b = await hashAccountId('user-123');
    expect(a).toEqual(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different digests for different inputs', async () => {
    const a = await hashAccountId('user-123');
    const b = await hashAccountId('user-456');
    expect(a).not.toEqual(b);
  });
});

describe('incrementAuthorship', () => {
  it('starts a new counter at 1', async () => {
    const kv = makeKV();
    await incrementAuthorship(kv, 'cloud-1', 'SPACE-A', 'user-1');
    const v = await getPersonalAuthored(kv, 'cloud-1', 'SPACE-A', 'user-1');
    expect(v).toBe(1);
  });

  it('increments an existing counter', async () => {
    const kv = makeKV();
    await incrementAuthorship(kv, 'cloud-1', 'SPACE-A', 'user-1');
    await incrementAuthorship(kv, 'cloud-1', 'SPACE-A', 'user-1');
    await incrementAuthorship(kv, 'cloud-1', 'SPACE-A', 'user-1');
    const v = await getPersonalAuthored(kv, 'cloud-1', 'SPACE-A', 'user-1');
    expect(v).toBe(3);
  });

  it('keeps separate counters per (cloud, space, user)', async () => {
    const kv = makeKV();
    await incrementAuthorship(kv, 'cloud-1', 'SPACE-A', 'user-1');
    await incrementAuthorship(kv, 'cloud-1', 'SPACE-B', 'user-1');
    await incrementAuthorship(kv, 'cloud-2', 'SPACE-A', 'user-1');
    expect(await getPersonalAuthored(kv, 'cloud-1', 'SPACE-A', 'user-1')).toBe(1);
    expect(await getPersonalAuthored(kv, 'cloud-1', 'SPACE-B', 'user-1')).toBe(1);
    expect(await getPersonalAuthored(kv, 'cloud-2', 'SPACE-A', 'user-1')).toBe(1);
  });

  it('hashes the accountId in the KV key', async () => {
    const kv = makeKV();
    await incrementAuthorship(kv, 'cloud-1', 'SPACE-A', 'user-1');
    const keys = Array.from((kv as any)._store.keys()) as string[];
    expect(keys[0]).not.toContain('user-1');
    expect(keys[0]).toMatch(/^authored:cloud-1:SPACE-A:[0-9a-f]{64}$/);
  });
});

describe('getPersonalAuthored', () => {
  it('returns 0 when no counter exists', async () => {
    const kv = makeKV();
    const v = await getPersonalAuthored(kv, 'cloud-1', 'SPACE-A', 'unknown-user');
    expect(v).toBe(0);
  });
});
