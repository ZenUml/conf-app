import { describe, expect, it } from 'vitest';

import { createExtensionActionRuntime } from './extensionActionRuntime';

class MemoryKV {
  readonly values = new Map<string, string>();

  async get(key: string, type?: string): Promise<unknown> {
    const value = this.values.get(key);
    if (value === undefined) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }

  async put(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

describe('extension action production runtime', () => {
  it('writes and verifies only the requester-scoped license key', async () => {
    const licenses = new MemoryKV();
    const runtime = createExtensionActionRuntime({
      DB: {} as D1Database,
      SPACE_LICENSE_KV: licenses as unknown as KVNamespace,
      confluence_plugin_features: new MemoryKV() as unknown as KVNamespace,
    }, () => new Date('2026-08-19T12:00:00Z'));

    await runtime.applyLicense({
      cloudId: 'cloud-example',
      spaceKey: 'ENGINEERING',
      userAccountId: '712020:example-account',
      expiresAt: '2026-08-26T23:59:59Z',
      activatedBy: 'support:auto:temp-7d-extension:ZEN-1234',
    });

    expect(licenses.values.has('license:cloud-example:ENGINEERING')).toBe(false);
    const raw = licenses.values.get('license:cloud-example:ENGINEERING:712020:example-account');
    expect(JSON.parse(raw!)).toMatchObject({
      cloudId: 'cloud-example',
      spaceKey: 'ENGINEERING',
      userAccountId: '712020:example-account',
      status: 'active',
      expiresAt: '2026-08-26T23:59:59Z',
      activatedBy: 'support:auto:temp-7d-extension:ZEN-1234',
    });
    expect(JSON.parse(licenses.values.get('license-index')!)).toContainEqual({
      cloudId: 'cloud-example',
      spaceKey: 'ENGINEERING',
      userAccountId: '712020:example-account',
    });
  });

  it('reads exact, case-sensitive Lite metrics from the server-side cache', async () => {
    const metrics = new MemoryKV();
    metrics.values.set('metrics:example-tenant:lite', JSON.stringify({
      spaces: {
        ENGINEERING: { total: 120, lastUpdated: '2026-08-19T11:00:00Z' },
      },
    }));
    const runtime = createExtensionActionRuntime({
      DB: {} as D1Database,
      SPACE_LICENSE_KV: new MemoryKV() as unknown as KVNamespace,
      confluence_plugin_features: metrics as unknown as KVNamespace,
    });

    await expect(runtime.findSpace('example-tenant.atlassian.net', 'ENGINEERING'))
      .resolves.toEqual({ macroCount: 120, lastUpdated: '2026-08-19T11:00:00Z' });
    await expect(runtime.findSpace('example-tenant.atlassian.net', 'engineering'))
      .resolves.toBeNull();
  });
});
