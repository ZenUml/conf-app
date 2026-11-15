import { describe, expect, it } from 'vitest';
import type { ForgeAppRequestBody } from '../RequestBody';
import { buildAppInstalledEvent } from './appInstalledAnalytics';
import { CANONICAL_EVENT_NAME_LIST } from './analyticsTypes';

const LITE_APP_ID = '8ad26115-211f-4216-971b-0540f606303d';

function body(overrides: Partial<ForgeAppRequestBody> = {}): ForgeAppRequestBody {
  return {
    eventType: 'avi:forge:installed:app',
    id: 'inst-1',
    context: 'ari:cloud:confluence::site/cloud-1',
    installerAccountId: 'acct-1',
    app: { id: LITE_APP_ID, name: 'ZenUML Lite', ownerAccountId: 'owner', version: '7.1.0' },
    environment: { id: 'env-1' },
    permissions: {
      scopes: [],
      external: { fetch: { backend: [], client: [] } },
      frames: [],
      scripts: [],
    },
    ...overrides,
  };
}

const ctx = { cloudId: 'cloud-1', clientDomain: 'example-tenant.atlassian.net', now: 1_700_000_000_123 };

describe('buildAppInstalledEvent', () => {
  it('is a registered backend event name', () => {
    expect(CANONICAL_EVENT_NAME_LIST).toContain('app_installed');
  });

  it('builds the install event keyed on the installer accountId', () => {
    expect(buildAppInstalledEvent(body(), ctx)).toEqual({
      event: 'app_installed',
      distinctId: 'acct-1',
      insertId: 'inst-1:app_installed',
      time: 1_700_000_000,
      properties: {
        feature_area: 'system',
        surface: 'forge_trigger',
        product_type: 'lite',
        installation_id: 'inst-1',
        cloud_id: 'cloud-1',
        app_version: '7.1.0',
        client_domain: 'example-tenant',
        installer_known: true,
      },
    });
  });

  it('skips upgrades, which fire on every install at every deploy', () => {
    expect(buildAppInstalledEvent(body({ eventType: 'avi:forge:upgraded:app' }), ctx)).toBeNull();
  });

  it('falls back to an installation-scoped distinct id without an installer', () => {
    const event = buildAppInstalledEvent(body({ installerAccountId: undefined }), ctx);
    expect(event?.distinctId).toBe('installation:inst-1');
    expect(event?.properties.installer_known).toBe(false);
  });

  it('leaves client_domain null when D1 does not know the site yet', () => {
    const event = buildAppInstalledEvent(body(), { ...ctx, clientDomain: null });
    expect(event?.properties.client_domain).toBeNull();
  });

  it('marks an unrecognised app id as unknown product', () => {
    const event = buildAppInstalledEvent(body({ app: { ...body().app, id: 'other' } }), ctx);
    expect(event?.properties.product_type).toBe('unknown');
  });
});
