import { describe, it, expect, vi } from 'vitest';
import { onRequestGet } from './plan-usage';

function makeEnv(domainData: unknown) {
  return {
    confluence_plugin_features: {
      get: vi.fn(async (_key: string, _type: string) => domainData),
    },
  };
}

async function call(domainData: unknown, client = 'example-tenant') {
  const request = new Request(`https://x/api/plan-usage?client=${client}`);
  const res = await (onRequestGet as any)({ request, env: makeEnv(domainData) });
  return { status: res.status, body: await res.json() };
}

describe('plan-usage spaces', () => {
  it('lists every space with a stored-diagram count, largest first, for "Where diagrams are used"', async () => {
    const { body } = await call({
      domain: 'example-tenant',
      spaces: {
        ENG: { space: 'ENG', total: 120, isLite: true, lastUpdated: '2026-10-22T00:00:00.000Z' },
        HR: { space: 'HR', total: 3, isLite: true },
        OPS: { space: 'OPS', total: 3, isLite: true, lastUpdated: '2026-10-21T00:00:00.000Z' },
        EMPTY: { space: 'EMPTY', total: 0, isLite: true },
      },
    });
    expect(body.spaces).toEqual([
      { spaceKey: 'ENG', macroCount: 120, lastUpdated: '2026-10-22T00:00:00.000Z' },
      { spaceKey: 'HR', macroCount: 3, lastUpdated: null },
      { spaceKey: 'OPS', macroCount: 3, lastUpdated: '2026-10-21T00:00:00.000Z' },
    ]);
    // The existing fields are untouched.
    expect(body.totalMacros).toBe(126);
    expect(body.overLimitSpaces).toEqual([{ spaceKey: 'ENG', macroCount: 120 }]);
  });

  it('is an empty list when KV holds nothing for the domain', async () => {
    const { body } = await call(null);
    expect(body.hasData).toBe(false);
    expect(body.spaces).toEqual([]);
  });

  it('still rejects a missing client domain', async () => {
    const { status } = await call({}, '');
    expect(status).toBe(400);
  });
});
