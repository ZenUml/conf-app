import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./utils/authenticate', () => ({ validateContextToken: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./utils/dbUtils', () => ({
  upsertForgeInstallation: vi.fn().mockResolvedValue({ cloudId: 'cloud-1', clientDomain: null }),
}));
vi.mock('./utils/analytics', () => ({
  normalizeForgeInstallAnalyticsEvent: vi.fn().mockReturnValue({}),
  archiveAnalyticsEvent: vi.fn().mockResolvedValue('r2-key'),
  insertAnalyticsEventFact: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('./utils/sentry', () => ({ captureError: vi.fn() }));
const importMock = vi.fn();
vi.mock('./service/mixpanelService', () => ({
  mixpanelImportServiceEvents: (...args: unknown[]) => importMock(...args),
}));

import { onRequest } from './forge-installed';
import { insertAnalyticsEventFact } from './utils/analytics';

function call(eventType: string, env: Record<string, unknown> = { MIXPANEL_TOKEN: 'tok' }) {
  const waitUntil = vi.fn();
  const request = new Request('https://example.test/forge-installed', {
    method: 'POST',
    headers: { Authorization: 'Bearer fit' },
    body: JSON.stringify({
      eventType,
      id: 'inst-1',
      context: 'ari:cloud:confluence::site/cloud-1',
      installerAccountId: 'acct-1',
      app: { id: '8ad26115-211f-4216-971b-0540f606303d', name: 'ZenUML Lite', ownerAccountId: 'o', version: '1.0.0' },
      environment: { id: 'env-1' },
      permissions: { scopes: [], external: { fetch: { backend: [], client: [] } }, frames: [], scripts: [] },
    }),
  });
  const ctx = { request, env: { ALLOWED_FORGE_APP_IDS: 'x', ...env }, waitUntil } as unknown as Parameters<typeof onRequest>[0];
  return { promise: onRequest(ctx) as Promise<Response>, waitUntil };
}

describe('forge-installed app_installed emission', () => {
  beforeEach(() => {
    importMock.mockReset().mockResolvedValue(undefined);
    vi.mocked(insertAnalyticsEventFact).mockClear();
  });

  it('sends app_installed via waitUntil on a first install', async () => {
    const { promise, waitUntil } = call('avi:forge:installed:app');
    expect((await promise).status).toBe(200);
    expect(waitUntil).toHaveBeenCalledTimes(1);
    const [events, token] = importMock.mock.calls[0];
    expect(token).toBe('tok');
    expect(events[0]).toMatchObject({ event: 'app_installed', distinctId: 'acct-1' });
  });

  it('sends nothing on an upgrade', async () => {
    const { promise, waitUntil } = call('avi:forge:upgraded:app');
    await promise;
    expect(importMock).not.toHaveBeenCalled();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it('sends nothing without a Mixpanel token', async () => {
    const { promise } = call('avi:forge:installed:app', { MIXPANEL_TOKEN: undefined });
    await promise;
    expect(importMock).not.toHaveBeenCalled();
  });

  it('keeps the D1 write and the 200 when Mixpanel delivery fails', async () => {
    importMock.mockRejectedValue(new Error('boom'));
    const { promise, waitUntil } = call('avi:forge:installed:app');
    expect((await promise).status).toBe(200);
    await expect(waitUntil.mock.calls[0][0]).resolves.toBeUndefined();
    expect(insertAnalyticsEventFact).toHaveBeenCalledTimes(1);
  });
});
