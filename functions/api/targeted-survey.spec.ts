import { beforeEach, describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestPatch, onRequestPost, onRequestPut } from './targeted-survey';

const FULL = 'd9e4002b-120b-426b-834b-402a4a5adce7';
const LITE = '8ad26115-211f-4216-971b-0540f606303d';
const identity = { forgeAppId: FULL, cloudId: 'example-cloud', accountId: 'example-account' };
const campaign = {
  uuid: '71861d63-dc0b-4a75-8a04-724711577d70', revision: 1, enabled: true,
  products: ['lite', 'full'], cloudId: identity.cloudId, accountId: identity.accountId,
  startsAt: '2026-01-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
  title: 'Help us improve ZenUML', question: 'What could we improve?',
  options: [{ id: 'editing', label: 'Editing diagrams' }],
};
type Lease = { token: string; app: string; expiry: number; terminal: string | null };

function harness() {
  let config = { ...campaign };
  let unavailable = false;
  const leases = new Map<string, Lease>();
  const responses = new Map<string, string>();
  const key = (revision: number) => `${config.uuid}:${revision}`;
  const db = { prepare(sql: string) {
    if (unavailable) throw new Error('D1 unavailable');
    const bind = (...args: any[]) => ({
      first: async () => {
        if (sql.includes('FROM TargetedSurveyLease') && sql.includes('SELECT terminal')) {
          const lease = leases.get(key(args[1]));
          return lease ? { terminal: lease.terminal } : null;
        }
        if (sql.includes('SELECT claimToken, forgeAppId, terminal')) {
          const lease = leases.get(key(args[1]));
          return lease ? { claimToken: lease.token, forgeAppId: lease.app, terminal: lease.terminal } : null;
        }
        if (sql.includes('SELECT submissionId')) {
          const submissionId = responses.get(key(args[1]));
          return submissionId ? { submissionId } : null;
        }
        if (sql.includes('SELECT id FROM TargetedSurveyResponse')) {
          return responses.has(key(args[1])) ? { id: 1 } : null;
        }
        return null;
      },
      run: async () => {
        if (sql.includes('INSERT INTO TargetedSurveyLease')) {
          const k = key(args[1]); const old = leases.get(k);
          if (old && (old.terminal || old.expiry > args[7])) return { success: true, meta: { changes: 0 } };
          leases.set(k, { token: args[5], app: args[4], expiry: args[6], terminal: null });
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes('UPDATE TargetedSurveyLease SET terminal')) {
          const k = key(args[1]); const old = leases.get(k);
          const expected = sql.includes("SET terminal = 'shown'") ? 'shown'
            : sql.includes("SET terminal = 'dismissed'") ? 'dismissed' : 'submitted';
          const permitted = expected === 'shown' ? old?.terminal === null && old.expiry > args[6]
            : old?.terminal === 'shown';
          if (!old || old.app !== args[4] || old.token !== args[5] || !permitted) return { success: true, meta: { changes: 0 } };
          old.terminal = expected;
          return { success: true, meta: { changes: 1 } };
        }
        if (sql.includes('INSERT OR IGNORE INTO TargetedSurveyResponse')) {
          const k = key(args[1]); const old = leases.get(k);
          if (old?.app === args[4] && old.token === args[8] && old.terminal === 'shown' && !responses.has(k)) {
            responses.set(k, args[5]); return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        }
        return { success: true, meta: { changes: 0 } };
      },
    });
    return { bind, first: async () => null };
  } };
  const env = { SPACE_LICENSE_KV: { get: async () => JSON.stringify(config) }, DB: db };
  const run = (method: 'GET' | 'PUT' | 'PATCH' | 'POST', fit: object = identity, body?: object) => {
    const handler = { GET: onRequestGet, PUT: onRequestPut, PATCH: onRequestPatch, POST: onRequestPost }[method];
    return handler({ request: new Request('https://example.test/api/targeted-survey', {
      method, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), env, data: { forgeContext: fit } } as any);
  };
  return { run, leases, responses, setRevision: (revision: number) => { config = { ...config, revision }; },
    setConfig: (value: object) => { config = { ...config, ...value }; },
    setDbUnavailable: () => { unavailable = true; } };
}

const attempt = (revision = 1) => ({ surveyUuid: campaign.uuid, revision });
const patch = (token: string, action: 'shown' | 'dismiss', revision = 1) => ({ ...attempt(revision), claimToken: token, action });
const submission = (token: string, revision = 1) => ({ ...attempt(revision), claimToken: token,
  submissionId: '8cf98cab-47a4-44cf-afce-b8f969a29b10', options: ['editing'], text: '' });

describe('targeted survey revision lease', () => {
  beforeEach(() => vi.useRealTimers());

  it('serves only the matching verified Lite and Full users', async () => {
    const api = harness();
    expect((await (await api.run('GET')).json() as any).survey).toMatchObject({ uuid: campaign.uuid, revision: 1 });
    expect((await (await api.run('GET', { ...identity, forgeAppId: LITE })).json() as any).survey).toBeTruthy();
    for (const fit of [{ ...identity, accountId: 'other' }, { ...identity, forgeAppId: 'other' }]) {
      expect(await (await api.run('GET', fit)).json()).toEqual({ survey: null });
    }
  });


  it('strips target and unknown config fields, and respects Full-only targeting', async () => {
    const api = harness();
    api.setConfig({ internalNote: 'private', products: ['full'], options: [{ id: 'editing', label: 'Editing diagrams', internalNote: 'private' }] });
    const result = await (await api.run('GET')).json() as any;
    expect(result.survey).not.toHaveProperty('accountId');
    expect(result.survey).not.toHaveProperty('cloudId');
    expect(result.survey).not.toHaveProperty('enabled');
    expect(result.survey).not.toHaveProperty('internalNote');
    expect(result.survey.options).toEqual([{ id: 'editing', label: 'Editing diagrams' }]);
    expect(await (await api.run('GET', { ...identity, forgeAppId: LITE })).json()).toEqual({ survey: null });
  });

  it('rejects stale revisions, malformed answers, and unknown options', async () => {
    const api = harness();
    const claim = await (await api.run('PUT', identity, attempt())).json() as any;
    await api.run('PATCH', identity, patch(claim.claimToken, 'shown'));
    for (const body of [
      { ...submission(claim.claimToken), revision: 0 },
      { ...submission(claim.claimToken), options: ['unknown'] },
      { ...submission(claim.claimToken), options: [], text: ' ' },
    ]) expect((await api.run('POST', identity, body)).status).toBe(400);
    expect(api.responses.size).toBe(0);
  });

  it('suppresses eligibility when D1 is unavailable or configuration is malformed', async () => {
    const unavailable = harness();
    unavailable.setDbUnavailable();
    expect((await unavailable.run('GET')).status).toBe(503);
    expect(await (await unavailable.run('GET')).json()).toEqual({ survey: null });
    const malformed = harness();
    malformed.setConfig({ revision: 0 });
    expect(await (await malformed.run('GET')).json()).toEqual({ survey: null });
  });

  it('answers every status as JSON with Cache-Control: no-store', async () => {
    const api = harness();
    const ok = await api.run('GET');
    expect(ok.status).toBe(200);
    expect(ok.headers.get('cache-control')).toBe('no-store');
    expect(ok.headers.get('content-type')).toBe('application/json');
    const rejected = await api.run('POST', identity, null as any);
    expect(rejected.status).toBe(400);
    expect(rejected.headers.get('cache-control')).toBe('no-store');
    expect(rejected.headers.get('content-type')).toBe('application/json');
    const unavailable = harness();
    unavailable.setDbUnavailable();
    const failed = await unavailable.run('GET');
    expect(failed.status).toBe(503);
    expect(failed.headers.get('cache-control')).toBe('no-store');
  });

  it('rejects malformed JSON objects without writing a response', async () => {
    const api = harness();
    expect((await api.run('POST', identity, null as any)).status).toBe(400);
    expect(api.responses.size).toBe(0);
  });

  it('allows one live lease across Full and Lite, then reclaims an expired unshown lease', async () => {
    const api = harness();
    const lite = { ...identity, forgeAppId: LITE };
    const first = await (await api.run('PUT', identity, attempt())).json() as any;
    expect(first.claimed).toBe(true);
    expect((await (await api.run('PUT', lite, attempt())).json() as any).claimed).toBe(false);
    expect((await (await api.run('GET', lite)).json() as any).survey).toBeTruthy();
    api.leases.get(`${campaign.uuid}:1`)!.expiry = Date.now() - 1;
    const reclaimed = await (await api.run('PUT', lite, attempt())).json() as any;
    expect(reclaimed.claimed).toBe(true);
    expect(reclaimed.claimToken).not.toBe(first.claimToken);
    expect((await api.run('PATCH', identity, patch(first.claimToken, 'shown'))).status).toBe(409);
    expect((await api.run('POST', identity, submission(first.claimToken))).status).toBe(409);
    expect((await api.run('PATCH', lite, patch(reclaimed.claimToken, 'shown'))).status).toBe(200);
    expect(await (await api.run('GET', identity)).json()).toEqual({ survey: null });
  });

  it('never confirms display after pending lease expiry', async () => {
    const api = harness();
    const claim = await (await api.run('PUT', identity, attempt())).json() as any;
    api.leases.get(`${campaign.uuid}:1`)!.expiry = Date.now() - 1;
    expect((await api.run('PATCH', identity, patch(claim.claimToken, 'shown'))).status).toBe(409);
  });

  it('persists dismissal and submission per revision, with idempotent retry', async () => {
    const api = harness();
    const first = await (await api.run('PUT', identity, attempt())).json() as any;
    expect((await api.run('PATCH', identity, patch(first.claimToken, 'shown'))).status).toBe(200);
    expect((await api.run('PATCH', identity, patch(first.claimToken, 'dismiss'))).status).toBe(200);
    expect((await api.run('PATCH', identity, patch(first.claimToken, 'dismiss'))).status).toBe(200);
    expect((await (await api.run('PUT', { ...identity, forgeAppId: LITE }, attempt())).json() as any).claimed).toBe(false);
    api.setRevision(2);
    const second = await (await api.run('PUT', { ...identity, forgeAppId: LITE }, attempt(2))).json() as any;
    expect(second.claimed).toBe(true);
    expect((await api.run('PATCH', { ...identity, forgeAppId: LITE }, patch(second.claimToken, 'shown', 2))).status).toBe(200);
    expect((await api.run('POST', { ...identity, forgeAppId: LITE }, submission(second.claimToken, 2))).status).toBe(201);
    expect((await api.run('POST', { ...identity, forgeAppId: LITE }, submission(second.claimToken, 2))).status).toBe(201);
    expect(await (await api.run('GET', identity)).json()).toEqual({ survey: null });
    expect((await api.run('POST', identity, submission(first.claimToken, 2))).status).toBe(409);
  });
});
