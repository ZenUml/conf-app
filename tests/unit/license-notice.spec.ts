import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../functions/utils/authenticate', () => ({ validateContextToken: vi.fn() }));
import { validateContextToken } from '../../functions/utils/authenticate';
import { onRequest } from '../../functions/api/license-notice';

const APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7';
const NOW = '2026-11-11T00:00:00.000Z';
const record = {
  schemaVersion: 1, licenseType: 'LEGACY_FREE', source: 'atlassian_marketplace',
  checkedAt: '2026-11-10T23:00:00.000Z', expiresAt: '2026-11-11T23:00:00.000Z',
  entitlementId: 'example-entitlement',
};
const verify = vi.mocked(validateContextToken);
function context(value: unknown = record, options: { method?: string; authorization?: string | null; raw?: boolean } = {}) {
  const get = vi.fn().mockResolvedValue(options.raw ? value : value === null ? null : JSON.stringify(value));
  return {
    request: new Request('https://example.com/api/license-notice?cloudId=forged-cloud&environmentType=production&forgeAppId=forged-app', {
      method: options.method ?? 'GET',
      headers: options.authorization === null ? {} : { Authorization: options.authorization ?? 'Bearer example-token' },
    }),
    env: { KV_FEATURE_FLAGS: { get } as unknown as KVNamespace },
    get,
  };
}
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(NOW);
  verify.mockReset();
  verify.mockResolvedValue({ cloudId: 'example-cloud', forgeAppId: APP_ID, environmentType: 'STAGING', payload: { app: {} } } as any);
});
afterEach(() => vi.useRealTimers());

describe('GET /api/license-notice', () => {
  it('uses only verified identity and accepts a guest without user credential', async () => {
    const ctx = context(); const response = await onRequest(ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Type')).toContain('application/json');
    expect(await response.json()).toEqual({ state: 'legacy_free', checkedAt: record.checkedAt, expiresAt: record.expiresAt });
    expect(verify).toHaveBeenCalledWith('example-token', APP_ID);
    expect(ctx.get).toHaveBeenCalledWith(`license-notice:${APP_ID}:staging:example-cloud`);
  });
  it.each([null, 'invalid', 'Bearer one two'])('rejects missing or malformed authorization %s', async authorization => {
    const ctx = context(record, { authorization }); const response = await onRequest(ctx);
    expect(response.status).toBe(401); expect(ctx.get).not.toHaveBeenCalled();
    expect(response.headers.get('Cache-Control')).toBe('no-store');
  });
  it('rejects an invalid token including a different app audience', async () => {
    verify.mockRejectedValue(new Error('FIT app.id is not allowlisted'));
    const ctx = context(); expect((await onRequest(ctx)).status).toBe(401);
    expect(verify).toHaveBeenCalledWith('example-token', APP_ID); expect(ctx.get).not.toHaveBeenCalled();
  });
  it('rejects a returned identity from another app defensively', async () => {
    verify.mockResolvedValue({ cloudId: 'example-cloud', forgeAppId: 'another-app', environmentType: 'STAGING' } as any);
    const ctx = context(); expect((await onRequest(ctx)).status).toBe(403); expect(ctx.get).not.toHaveBeenCalled();
  });
  it.each([undefined, '', 'PREVIEW'])('returns unknown for unsupported environment %s', async environmentType => {
    verify.mockResolvedValue({ cloudId: 'example-cloud', forgeAppId: APP_ID, environmentType } as any);
    const ctx = context(); expect(await (await onRequest(ctx)).json()).toEqual({ state: 'unknown' }); expect(ctx.get).not.toHaveBeenCalled();
  });
  it.each(['DEVELOPMENT', 'STAGING', 'PRODUCTION'])('normalizes supported %s environments', async environmentType => {
    verify.mockResolvedValue({ cloudId: 'example-cloud', forgeAppId: APP_ID, environmentType } as any);
    const ctx = context();
    expect(await (await onRequest(ctx)).json()).toMatchObject({ state: 'legacy_free' });
    expect(ctx.get).toHaveBeenCalledWith(`license-notice:${APP_ID}:${environmentType.toLowerCase()}:example-cloud`);
  });
  it('suppresses a record when the FIT reports an active license', async () => {
    verify.mockResolvedValue({ cloudId: 'example-cloud', forgeAppId: APP_ID, environmentType: 'STAGING', payload: { app: { license: { active: true } } } } as any);
    const ctx = context(); expect(await (await onRequest(ctx)).json()).toEqual({ state: 'unknown' }); expect(ctx.get).not.toHaveBeenCalled();
  });
  it.each([
    null, {}, [], { ...record, schemaVersion: 2 }, { ...record, licenseType: 'UNLICENSED' },
    { ...record, source: 'manual' }, { ...record, entitlementId: '' }, { ...record, entitlementId: '  ' },
    { ...record, checkedAt: 'invalid' }, { ...record, checkedAt: '2026-11-12T00:00:00.000Z' },
    { ...record, expiresAt: NOW }, { ...record, expiresAt: '2026-11-10T22:00:00.000Z' },
    { ...record, expiresAt: '2026-11-12T00:00:00.000Z' }, { ...record, expiresAt: 123 },
    { ...record, checkedAt: '2026-11-10' }, { ...record, checkedAt: '2026-02-30T00:00:00.000Z' },
  ])('returns unknown for missing or invalid record %#', async value => {
    expect(await (await onRequest(context(value))).json()).toEqual({ state: 'unknown' });
  });
  it('returns unknown for malformed JSON', async () => {
    expect(await (await onRequest(context('{', { raw: true }))).json()).toEqual({ state: 'unknown' });
  });
  it('returns unknown when KV fails', async () => {
    const ctx = context(); ctx.get.mockRejectedValue(new Error('unavailable'));
    expect(await (await onRequest(ctx)).json()).toEqual({ state: 'unknown' });
  });
  it.each(['POST', 'PUT', 'DELETE', 'OPTIONS'])('rejects %s as JSON without reading KV', async method => {
    const ctx = context(record, { method }); const response = await onRequest(ctx);
    expect(response.status).toBe(405); expect(response.headers.get('Allow')).toBe('GET');
    expect(await response.json()).toEqual({ error: 'method_not_allowed' }); expect(ctx.get).not.toHaveBeenCalled();
  });
});
