import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleToken } from './authServer';
import { mixpanelTrack } from '../../service/mixpanelService';
import { onRequestPost } from './token';

vi.mock('./authServer', () => ({
  handleToken: vi.fn(),
}));

vi.mock('../../service/mixpanelService', () => ({
  mixpanelTrack: vi.fn(async () => undefined),
}));

const env = {
  DB: {},
  MIXPANEL_TOKEN: 'test-mixpanel-token',
  OAUTH_GRANT_KV: { get: async () => null, put: async () => undefined, delete: async () => undefined },
  OAUTH_GRANT_SECRET: 'never-echo-this-secret',
};

function refreshRequest() {
  return new Request('https://example.zenuml.com/agent-link/oauth/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'opaque', client_id: 'client-A' }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('OAuth token route configuration', () => {
  it('returns a clean 503 for a refresh request when D1 is not bound', async () => {
    const request = refreshRequest();
    const response = await onRequestPost({ request, env: {
      OAUTH_GRANT_KV: { get: async () => null, put: async () => undefined, delete: async () => undefined },
      OAUTH_GRANT_SECRET: 'never-echo-this-secret',
    }, waitUntil: () => undefined } as never);
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"temporarily_unavailable"}');
  });

  it('maps a reused-token age into the refresh completion telemetry event', async () => {
    vi.mocked(handleToken).mockImplementationOnce(async (_request, deps) => {
      await deps.onRefreshCompleted?.({ outcome: 'rejected', reason: 'reused', userId: 'acct-1', reuseAgeMs: 300_000 });
      return new Response('{"ok":true}', { status: 200 });
    });
    const waitUntil = vi.fn((promise: Promise<unknown>) => promise);

    const response = await onRequestPost({ request: refreshRequest(), env, waitUntil } as never);

    expect(response.status).toBe(200);
    expect(handleToken).toHaveBeenCalledOnce();
    expect(mixpanelTrack).toHaveBeenCalledWith(expect.objectContaining({
      event: 'agent_link_oauth_token_refresh_completed',
      oauth_refresh_outcome: 'rejected',
      reason: 'reused',
      refresh_reuse_age_ms: 300_000,
      user_account_id: 'acct-1',
    }), 'test-mixpanel-token', env);
    expect(waitUntil).toHaveBeenCalledOnce();
  });
});
