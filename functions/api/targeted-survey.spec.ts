import { describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestPost, onRequestPut } from './targeted-survey';

const FULL_APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7';
const LITE_APP_ID = '8ad26115-211f-4216-971b-0540f606303d';
const identity = {
  forgeAppId: FULL_APP_ID,
  cloudId: 'example-cloud',
  accountId: 'example-account',
  installationId: 'example-installation',
};
const campaign = {
  uuid: '71861d63-dc0b-4a75-8a04-724711577d70',
  revision: 1,
  enabled: true,
  products: ['full', 'lite'],
  cloudId: 'example-cloud',
  accountId: 'example-account',
  startsAt: '2026-01-01T00:00:00.000Z',
  expiresAt: '2099-01-01T00:00:00.000Z',
  title: 'Help us improve ZenUML',
  question: 'What could we improve?',
  options: [
    { id: 'performance', label: 'Loading or responsiveness' },
    { id: 'editing', label: 'Editing diagrams' },
    { id: 'display', label: 'Display or layout' },
    { id: 'export', label: 'Exporting or sharing' },
    { id: 'missing_feature', label: 'A feature I need is missing' },
    { id: 'other', label: 'Something else' },
  ],
};

function harness(overrides: { fit?: object; config?: object | null; storageError?: boolean; dbReadError?: boolean } = {}) {
  const run = vi.fn(async () => ({ success: !overrides.storageError }));
  const first = vi.fn(async () => {
    if (overrides.dbReadError) throw new Error('D1 unavailable');
    return null;
  });
  const bind = vi.fn(() => ({ run, first }));
  const db = { prepare: vi.fn((sql: string) => ({
    bind: (...args: any[]) => sql.includes('SELECT claimToken')
      ? { first: vi.fn(async () => ({ claimToken: 'claim-example', forgeAppId: identity.forgeAppId })) }
      : bind(...args),
    first,
  })), bind, run };
  const env = {
    SPACE_LICENSE_KV: { get: vi.fn(async () => JSON.stringify(overrides.config === undefined ? campaign : overrides.config)) },
    DB: db,
  };
  const data = { forgeContext: overrides.fit === undefined ? identity : overrides.fit };
  const get = () => onRequestGet({ request: new Request('https://example.test/api/targeted-survey'), env, data } as any);
  const post = (body: object) => onRequestPost({
    request: new Request('https://example.test/api/targeted-survey', { method: 'POST', body: JSON.stringify(body) }), env, data,
  } as any);
  const put = (body: object) => onRequestPut({
    request: new Request('https://example.test/api/targeted-survey', { method: 'PUT', body: JSON.stringify(body) }), env, data,
  } as any);
  return { get, post, put, env, db };
}

describe('targeted survey authenticated API', () => {
  it('returns only public campaign fields to the matching verified Full identity', async () => {
    const result = await harness().get();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ survey: {
      uuid: campaign.uuid, revision: 1, expiresAt: campaign.expiresAt, title: campaign.title, question: campaign.question,
      options: campaign.options,
    } });
  });

  it('does not disclose a campaign to another verified account or app', async () => {
    for (const fit of [{ ...identity, accountId: 'other' }, { ...identity, forgeAppId: 'lite-app' }]) {
      expect(await (await harness({ fit }).get()).json()).toEqual({ survey: null });
    }
  });

  it('offers the same campaign to a verified Lite identity', async () => {
    const response = await harness({ fit: { ...identity, forgeAppId: LITE_APP_ID } }).get();
    expect((await response.json() as any).survey.uuid).toBe(campaign.uuid);
  });

  it('honors a campaign limited to Full', async () => {
    const response = await harness({
      fit: { ...identity, forgeAppId: LITE_APP_ID },
      config: { ...campaign, products: ['full'] },
    }).get();
    expect(await response.json()).toEqual({ survey: null });
  });

  it('strips unexpected KV fields from each public choice', async () => {
    const config = { ...campaign, options: [{ id: 'editing', label: 'Editing diagrams', internalNote: 'private target detail' }] };
    const body = await (await harness({ config }).get()).json() as any;
    expect(body.survey.options).toEqual([{ id: 'editing', label: 'Editing diagrams' }]);
  });

  it('accepts a text-only response and idempotently stores one response per verified recipient', async () => {
    const api = harness();
    const body = { surveyUuid: campaign.uuid, revision: 1, claimToken: 'claim-example', submissionId: '8cf98cab-47a4-44cf-afce-b8f969a29b10', options: [], text: 'I need better labels.' };
    const response = await api.post(body);
    expect(response.status).toBe(201);
    expect(api.db.bind.mock.calls[0]).toContain(identity.accountId);
    expect(api.db.bind.mock.calls[0]).not.toContain('untrusted');
  });

  it('rejects empty answers and unknown choices', async () => {
    const api = harness();
    for (const body of [
      { surveyUuid: campaign.uuid, revision: 1, claimToken: 'claim-example', submissionId: crypto.randomUUID(), options: [], text: ' ' },
      { surveyUuid: campaign.uuid, revision: 1, claimToken: 'claim-example', submissionId: crypto.randomUUID(), options: ['unknown'], text: '' },
    ]) expect((await api.post(body)).status).toBe(400);
  });

  it('suppresses the banner when the response table is unavailable', async () => {
    const response = await harness({ dbReadError: true }).get();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ survey: null });
  });

  it('rejects stale revisions and malformed JSON objects without writing', async () => {
    const api = harness();
    const stale = {
      surveyUuid: campaign.uuid, revision: 0, claimToken: 'claim-example', submissionId: crypto.randomUUID(),
      options: ['editing'], text: '',
    };
    expect((await api.post(stale)).status).toBe(400);
    expect((await api.post(null as any)).status).toBe(400);
    expect(api.db.run).not.toHaveBeenCalled();
  });

  it('atomically grants one display claim across Full and Lite and requires its token to submit', async () => {
    let claim: { token: string; cloudId: string; accountId: string; forgeAppId: string } | null = null;
    const saved = vi.fn(async () => ({ success: true, meta: { changes: 1 } }));
    const db = {
      prepare: (sql: string) => ({
        first: async () => null,
        bind: (...args: any[]) => ({
          first: async () => {
            if (sql.includes('SELECT claimToken')) return claim ? { claimToken: claim.token, forgeAppId: claim.forgeAppId } : null;
            if (sql.includes('SELECT id FROM TargetedSurveyClaim WHERE')) return claim ? { id: 1 } : null;
            return null;
          },
          run: async () => {
            if (sql.includes('INSERT OR IGNORE INTO TargetedSurveyClaim')) {
              if (claim) return { success: true, meta: { changes: 0 } };
              claim = { token: args[4], cloudId: args[1], accountId: args[2], forgeAppId: args[3] };
              return { success: true, meta: { changes: 1 } };
            }
            return saved();
          },
        }),
      }),
    };
    let activeCampaign = { ...campaign };
    const env = { SPACE_LICENSE_KV: { get: async () => JSON.stringify(activeCampaign) }, DB: db };
    const request = (method: string, body?: object) => new Request('https://example.test/api/targeted-survey', {
      method, ...(body && { body: JSON.stringify(body) }),
    });
    const run = (fit: object, method: 'GET' | 'PUT' | 'POST', body?: object) => {
      const handler = { GET: onRequestGet, PUT: onRequestPut, POST: onRequestPost }[method];
      return handler({ request: request(method, body), env, data: { forgeContext: fit } } as any);
    };
    const lite = { ...identity, forgeAppId: LITE_APP_ID };
    const attempt = { surveyUuid: campaign.uuid, revision: 1 };
    const [fullResult, liteResult] = await Promise.all([run(identity, 'PUT', attempt), run(lite, 'PUT', attempt)]);
    const [fullBody, liteBody] = await Promise.all([fullResult.json(), liteResult.json()]) as any[];
    expect([fullBody.claimed, liteBody.claimed].sort()).toEqual([false, true]);
    expect(await (await run(identity, 'GET')).json()).toEqual({ survey: null });
    expect(await (await run(lite, 'GET')).json()).toEqual({ survey: null });
    const winner = fullBody.claimed ? identity : lite;
    const token = fullBody.claimToken ?? liteBody.claimToken;
    const response = { ...attempt, claimToken: token, submissionId: crypto.randomUUID(), options: ['editing'], text: '' };
    expect((await run(winner, 'POST', response)).status).toBe(201);
    const loser = fullBody.claimed ? lite : identity;
    expect((await run(loser, 'POST', response)).status).toBe(404);
    expect((await run(winner, 'POST', { ...response, claimToken: 'wrong' })).status).toBe(404);
    activeCampaign = { ...activeCampaign, revision: 2 };
    expect(await (await run(lite, 'GET')).json()).toEqual({ survey: null });
  });
});
