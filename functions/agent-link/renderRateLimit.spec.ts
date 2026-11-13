import { describe, it, expect } from 'vitest';
import { addressKey, checkRenderRate, RENDER_LIMIT, type RateDb } from './renderRateLimit';

/** Enough of D1 for the one UPSERT and the sweep, with the same semantics. */
function fakeDb(opts: { fail?: boolean } = {}) {
  const rows = new Map<string, number>();
  const calls: string[] = [];
  const db: RateDb = {
    prepare(sql: string) {
      return {
        bind(...values: unknown[]) {
          return {
            async first<T>() {
              calls.push(sql);
              if (opts.fail) throw new Error('no such table: McpRenderRate');
              const key = `${values[0]}|${values[1]}`;
              const count = (rows.get(key) ?? 0) + 1;
              rows.set(key, count);
              return { count } as T;
            },
            async run() {
              calls.push(sql);
              for (const k of [...rows.keys()]) if (Number(k.split('|')[1]) < Number(values[0])) rows.delete(k);
              return {};
            },
          };
        },
      };
    },
  };
  return { db, rows, calls };
}

const T0 = 1_800_000_000_000; // on a minute boundary
const never = () => 1;

describe('checkRenderRate', () => {
  it(`allows ${RENDER_LIMIT} calls a minute and refuses the next, with seconds to the window's end`, async () => {
    const { db } = fakeDb();
    for (let i = 1; i <= RENDER_LIMIT; i++) {
      expect(await checkRenderRate({ DB: db }, '203.0.113.7', T0 + 15_000, never)).toEqual({ allowed: true, count: i });
    }
    expect(await checkRenderRate({ DB: db }, '203.0.113.7', T0 + 15_000, never)).toEqual({
      allowed: false,
      count: RENDER_LIMIT + 1,
      retryAfterSeconds: 45,
    });
  });

  it('starts a fresh count in the next window', async () => {
    const { db } = fakeDb();
    for (let i = 0; i <= RENDER_LIMIT; i++) await checkRenderRate({ DB: db }, '203.0.113.7', T0, never);
    expect(await checkRenderRate({ DB: db }, '203.0.113.7', T0 + 60_000, never)).toEqual({ allowed: true, count: 1 });
  });

  it('counts addresses separately, and one IPv6 /64 as one caller', async () => {
    const { db } = fakeDb();
    await checkRenderRate({ DB: db }, '2001:db8:1:2::1', T0, never);
    expect(await checkRenderRate({ DB: db }, '2001:db8:1:2:ffff::9', T0, never)).toEqual({ allowed: true, count: 2 });
    expect(await checkRenderRate({ DB: db }, '198.51.100.1', T0, never)).toEqual({ allowed: true, count: 1 });
  });

  it('never stores the address itself', async () => {
    const { db, rows } = fakeDb();
    await checkRenderRate({ DB: db, OAUTH_GRANT_SECRET: 's' }, '203.0.113.7', T0, never);
    expect([...rows.keys()].join()).not.toContain('203.0.113');
  });

  it('fails open without D1, without an address, or when the table is missing', async () => {
    expect(await checkRenderRate({}, '203.0.113.7', T0)).toEqual({ allowed: true, unavailable: true });
    expect(await checkRenderRate({ DB: fakeDb().db }, null, T0)).toEqual({ allowed: true, unavailable: true });
    expect(await checkRenderRate({ DB: fakeDb({ fail: true }).db }, '203.0.113.7', T0)).toEqual({ allowed: true, unavailable: true });
  });

  it('sometimes sweeps rows from past windows', async () => {
    const { db, rows, calls } = fakeDb();
    await checkRenderRate({ DB: db }, '203.0.113.7', T0, never);
    await checkRenderRate({ DB: db }, '203.0.113.7', T0 + 60_000, () => 0);
    expect(calls.some((s) => s.startsWith('DELETE'))).toBe(true);
    expect(rows.size).toBe(1);
  });
});

describe('addressKey', () => {
  it('keeps IPv4 whole and folds IPv6 to its /64', () => {
    expect(addressKey('203.0.113.7')).toBe('203.0.113.7');
    expect(addressKey('2001:0db8:0001:0002:0000:0000:0000:0001')).toBe('2001:db8:1:2::/64');
    expect(addressKey('2001:db8::1')).toBe('2001:db8:0:0::/64');
  });
});
