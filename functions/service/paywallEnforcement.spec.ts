import { describe, expect, it, vi } from 'vitest';
import {
  decideEnforcement, effectsInForce, effectsOf, parseEnforcementPolicy, resolveEnforcement,
  stageInForce, thresholdReached, type EnforcementStage,
} from './paywallEnforcement';

const LITE = '8ad26115-211f-4216-971b-0540f606303d';
const EFFECTIVE = '2026-12-08T00:00:00Z';
const policy = (stage: string, effectiveAt: unknown = EFFECTIVE) => JSON.stringify({ stage, effectiveAt });

describe('stage in force', () => {
  it.each([
    ['key absent', null, '2026-12-09T00:00:00Z', null],
    ['not JSON', 'nope', '2026-12-09T00:00:00Z', null],
    ['not an object', '[1]', '2026-12-09T00:00:00Z', null],
    ['unknown stage', policy('block_all'), '2026-12-09T00:00:00Z', null],
    ['effectiveAt missing', JSON.stringify({ stage: 'watermark' }), '2026-12-09T00:00:00Z', null],
    ['effectiveAt not a date', policy('watermark', 'soon'), '2026-12-09T00:00:00Z', null],
    ['notice early', policy('notice'), '2026-11-20T00:00:00Z', 'notice'],
    ['notice late', policy('notice'), '2026-12-09T00:00:00Z', 'notice'],
    ['watermark before', policy('watermark'), '2026-12-07T23:59:59Z', 'notice'],
    ['watermark at', policy('watermark'), '2026-12-08T00:00:00Z', 'watermark'],
    ['block_create before', policy('block_create'), '2026-12-07T23:59:59Z', 'notice'],
    ['block_create at', policy('block_create'), '2026-12-08T00:00:00Z', 'block_create'],
    ['block_edit at', policy('block_edit'), '2026-12-08T00:00:00Z', 'block_edit'],
  ])('%s', (_n, raw, now, expected) => {
    expect(stageInForce(parseEnforcementPolicy(raw), new Date(now))).toBe(expected);
  });
});

// The published limit is 100; enforcement starts at 150 so a miscount near 100 cannot trigger it.
describe('enforcement threshold reached', () => {
  it.each([
    [0, 'no'], [99, 'no'], [100, 'no'], [101, 'no'], [149, 'no'], [150, 'yes'], [151, 'yes'], [2282, 'yes'],
    [null, 'unknown'], [undefined, 'unknown'], [1.5, 'unknown'], [-1, 'unknown'], ['150', 'unknown'],
  ])('count %s -> %s', (count, expected) => {
    expect(thresholdReached(count)).toBe(expected);
  });
});

describe('enforcement', () => {
  it.each([
    [null, 'yes', 'no', 'off'],
    ['watermark', 'no', 'no', 'off'],
    ['watermark', 'unknown', 'no', 'off'],
    ['watermark', 'yes', 'yes', 'off'],
    ['watermark', 'yes', 'unknown', 'off'],
    ['notice', 'yes', 'no', 'notice'],
    ['watermark', 'yes', 'no', 'watermark'],
    ['block_create', 'yes', 'no', 'block_create'],
    ['block_edit', 'yes', 'no', 'block_edit'],
  ] as const)('stage %s, limit %s, covered %s -> %s', (stage, limit, covered, expected) => {
    expect(decideEnforcement({ stage: stage as EnforcementStage | null, limit, covered })).toBe(expected);
  });
});

describe('effects', () => {
  // A legacy `{ stage }` key keeps the cumulative ladder.
  it.each([
    ['notice', true, false, false, false],
    ['watermark', true, true, false, false],
    ['block_create', true, true, true, false],
    ['block_edit', true, true, true, true],
  ] as const)('legacy %s', (stage, datedBanner, watermark, blockCreate, requestEdit) => {
    // `meterEdit` is the old name of `requestEdit`. Both are emitted until every client reads the new one,
    // so no deploy order makes an old client drop the whole enforcement object.
    expect(effectsOf(parseEnforcementPolicy(policy(stage))!.effects))
      .toEqual({ datedBanner, watermark, blockCreate, requestEdit, meterEdit: requestEdit });
  });

  const switches = (effects: unknown, effectiveAt: unknown = EFFECTIVE) => JSON.stringify({ effects, effectiveAt });
  it.each([
    ['edit only: no watermark, create open', { requestEdit: true }, { watermark: false, blockCreate: false, requestEdit: true }, 'block_edit'],
    ['create only', { blockCreate: true }, { watermark: false, blockCreate: true, requestEdit: false }, 'block_create'],
    ['watermark and edit, create open', { watermark: true, requestEdit: true }, { watermark: true, blockCreate: false, requestEdit: true }, 'block_edit'],
    ['nothing on is notice', {}, { watermark: false, blockCreate: false, requestEdit: false }, 'notice'],
  ] as const)('independent switches: %s', (_n, given, effects, stage) => {
    expect(parseEnforcementPolicy(switches(given))).toEqual({ stage, effects, effectiveAt: EFFECTIVE });
  });
  it.each([
    ['a non-boolean switch', switches({ requestEdit: 'yes' })],
    ['an unknown switch', switches({ blockView: true })],
    ['both shapes at once', JSON.stringify({ stage: 'watermark', effects: { requestEdit: true }, effectiveAt: EFFECTIVE })],
    ['effects not an object', switches([true])],
    ['no effectiveAt', JSON.stringify({ effects: { requestEdit: true } })],
  ])('independent switches: %s -> no policy', (_n, raw) => {
    expect(parseEnforcementPolicy(raw)).toBeNull();
  });
  it('independent switches stay off until effectiveAt', () => {
    const p = parseEnforcementPolicy(switches({ requestEdit: true }))!;
    expect(effectsInForce(p, new Date('2026-12-07T23:59:59Z'))).toEqual({ watermark: false, blockCreate: false, requestEdit: false });
    expect(effectsInForce(p, new Date(EFFECTIVE))).toEqual({ watermark: false, blockCreate: false, requestEdit: true });
  });
});

function fakeEnv(options: {
  policy?: string | null; count?: number | null; exemptions?: string | null; domain?: string | null;
} = {}) {
  const { policy: pol = policy('watermark'), count = 2282, exemptions = '{}', domain = 'example-tenant.atlassian.net' } = options;
  const kvGet = vi.fn(async (key: string, type?: string) => {
    if (key === 'paywall-enforcement:policy:cloud-1') return pol;
    if (key === 'PAYWALL_EXEMPTIONS') return exemptions;
    if (key === 'metrics:example-tenant:lite' && type === 'json') {
      return count === null ? { spaces: {} } : { spaces: { ENG: { total: count } } };
    }
    return null;
  });
  const dbFirst = vi.fn(async () => (domain ? { clientDomain: domain } : null));
  const metricsGet = vi.fn(async (key: string, type?: string) => kvGet(key, type));
  return {
    env: {
      KV_FEATURE_FLAGS: { get: kvGet } as unknown as KVNamespace,
      confluence_plugin_features: { get: metricsGet } as unknown as KVNamespace,
      DB: { prepare: vi.fn(() => ({ bind: vi.fn(() => ({ first: dbFirst })) })) } as unknown as D1Database,
    },
    kvGet, dbFirst,
  };
}
const input = { cloudId: 'cloud-1', forgeAppId: LITE, spaceKey: 'ENG' };
const AFTER = new Date('2026-12-09T00:00:00Z');

describe('resolveEnforcement end-to-end examples', () => {
  it('1: count 2,282, no cover -> watermark', async () => {
    const result = await resolveEnforcement(fakeEnv().env, input, AFTER);
    expect(result).toEqual({
      stage: 'watermark', effectiveAt: EFFECTIVE, count: 2282, limit: 100,
      effects: { datedBanner: true, watermark: true, blockCreate: false, requestEdit: false, meterEdit: false },
    });
  });
  it('2: count 150 -> watermark, still reported against the published limit of 100', async () => {
    const result = await resolveEnforcement(fakeEnv({ count: 150 }).env, input, AFTER);
    expect(result?.stage).toBe('watermark');
    expect(result?.limit).toBe(100);
  });
  it('3: count 149, 100 and 99 (inside the buffer or under the limit) -> off', async () => {
    for (const count of [149, 100, 99]) {
      expect(await resolveEnforcement(fakeEnv({ count }).env, input, AFTER)).toBeNull();
    }
  });
  it('4: unknown count -> off', async () => {
    expect(await resolveEnforcement(fakeEnv({ count: null }).env, input, AFTER)).toBeNull();
  });
  it('9: site domain exempt -> off; wildcard too', async () => {
    expect(await resolveEnforcement(fakeEnv({ exemptions: '{"example-tenant":true}' }).env, input, AFTER)).toBeNull();
    expect(await resolveEnforcement(fakeEnv({ exemptions: '{"*":true}' }).env, input, AFTER)).toBeNull();
    expect((await resolveEnforcement(fakeEnv({ exemptions: '{"example-tenant":false}' }).env, input, AFTER))?.stage)
      .toBe('watermark');
  });
  it('10: exemption list unreadable -> off', async () => {
    for (const exemptions of [null, 'not json', '[]', '{"a":"yes"}']) {
      expect(await resolveEnforcement(fakeEnv({ exemptions }).env, input, AFTER)).toBeNull();
    }
  });
  it('11: before effectiveAt -> notice with no watermark', async () => {
    const result = await resolveEnforcement(fakeEnv().env, input, new Date('2026-12-01T00:00:00Z'));
    expect(result?.stage).toBe('notice');
    expect(result?.effects.watermark).toBe(false);
    expect(result?.effects.datedBanner).toBe(true);
  });
  it('independent switches: edit blocked, create open, no watermark', async () => {
    const pol = JSON.stringify({ effects: { requestEdit: true }, effectiveAt: EFFECTIVE });
    expect(await resolveEnforcement(fakeEnv({ policy: pol }).env, input, AFTER)).toEqual({
      stage: 'block_edit', effectiveAt: EFFECTIVE, count: 2282, limit: 100,
      effects: { datedBanner: true, watermark: false, blockCreate: false, requestEdit: true, meterEdit: true },
    });
  });
  it('12: no policy key -> off after exactly one KV read and no other reads', async () => {
    const { env, kvGet, dbFirst } = fakeEnv({ policy: null });
    expect(await resolveEnforcement(env, input, AFTER)).toBeNull();
    expect(kvGet).toHaveBeenCalledTimes(1);
    expect(dbFirst).not.toHaveBeenCalled();
  });
});

describe('resolveEnforcement fail-open', () => {
  it('non-Lite app -> null', async () => {
    expect(await resolveEnforcement(fakeEnv().env, { ...input, forgeAppId: 'other-app' }, AFTER)).toBeNull();
  });
  it('missing binding or thrown error -> null', async () => {
    expect(await resolveEnforcement({}, input, AFTER)).toBeNull();
    const { env } = fakeEnv();
    expect(await resolveEnforcement({ ...env, DB: undefined }, input, AFTER)).toBeNull();
    const boom = { ...env, KV_FEATURE_FLAGS: { get: vi.fn(async () => { throw new Error('KV down'); }) } as unknown as KVNamespace };
    expect(await resolveEnforcement(boom, input, AFTER)).toBeNull();
  });
  it('unresolvable domain -> null', async () => {
    expect(await resolveEnforcement(fakeEnv({ domain: null }).env, input, AFTER)).toBeNull();
  });
});
