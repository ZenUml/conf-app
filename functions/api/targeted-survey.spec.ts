import { describe, expect, it, vi } from 'vitest';
import { onRequestGet, onRequestPost } from './targeted-survey';

const FULL_APP_ID = 'd9e4002b-120b-426b-834b-402a4a5adce7';
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
  product: 'full',
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
  const db = { prepare: vi.fn(() => ({ bind, first })), bind, run };
  const env = {
    SPACE_LICENSE_KV: { get: vi.fn(async () => JSON.stringify(overrides.config === undefined ? campaign : overrides.config)) },
    DB: db,
  };
  const data = { forgeContext: overrides.fit === undefined ? identity : overrides.fit };
  const get = () => onRequestGet({ request: new Request('https://example.test/api/targeted-survey'), env, data } as any);
  const post = (body: object) => onRequestPost({
    request: new Request('https://example.test/api/targeted-survey', { method: 'POST', body: JSON.stringify(body) }), env, data,
  } as any);
  return { get, post, env, db };
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

  it('strips unexpected KV fields from each public choice', async () => {
    const config = { ...campaign, options: [{ id: 'editing', label: 'Editing diagrams', internalNote: 'private target detail' }] };
    const body = await (await harness({ config }).get()).json() as any;
    expect(body.survey.options).toEqual([{ id: 'editing', label: 'Editing diagrams' }]);
  });

  it('accepts a text-only response and idempotently stores one response per verified recipient', async () => {
    const api = harness();
    const body = { surveyUuid: campaign.uuid, revision: 1, submissionId: '8cf98cab-47a4-44cf-afce-b8f969a29b10', options: [], text: 'I need better labels.' };
    const response = await api.post(body);
    expect(response.status).toBe(201);
    expect(api.db.bind.mock.calls[0]).toContain(identity.accountId);
    expect(api.db.bind.mock.calls[0]).not.toContain('untrusted');
  });

  it('rejects empty answers and unknown choices', async () => {
    const api = harness();
    for (const body of [
      { surveyUuid: campaign.uuid, revision: 1, submissionId: crypto.randomUUID(), options: [], text: ' ' },
      { surveyUuid: campaign.uuid, revision: 1, submissionId: crypto.randomUUID(), options: ['unknown'], text: '' },
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
      surveyUuid: campaign.uuid, revision: 0, submissionId: crypto.randomUUID(),
      options: ['editing'], text: '',
    };
    expect((await api.post(stale)).status).toBe(400);
    expect((await api.post(null as any)).status).toBe(400);
    expect(api.db.run).not.toHaveBeenCalled();
  });
});
