import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import forgeGlobal from '@/model/globals/forgeGlobal';
import { callSandboxBridge, installSandboxRuntime } from './runtime';

describe('sandbox runtime', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/sandbox-app.html?sandbox=seq-edit');
  });

  afterEach(() => {
    delete (globalThis as any).__bridge;
  });

  it('installs a standalone Forge context for the selected preset', () => {
    const preset = installSandboxRuntime();

    expect(preset.id).toBe('seq-edit');
    expect(forgeGlobal.forgeContext).toMatchObject({
      extension: {
        type: 'standalone',
        content: { id: 'local-dev-page', type: 'page' },
      },
      accountId: 'forge-sandbox-user',
    });
  });

  it('returns Forge-compatible response shapes for product requests', async () => {
    await expect(callSandboxBridge('fetchProduct', {
      restPath: '/wiki/api/v2/custom-content/fake-content-id-diagram-sequence',
      fetchRequestInit: { method: 'GET' },
    })).resolves.toMatchObject({
      headers: { 'content-type': 'application/json' },
      statusText: 'OK',
      status: 200,
      isAttachment: false,
    });

    await expect(callSandboxBridge('invoke', {
      invokeType: 'ui-remote-fetch',
    })).resolves.toEqual({
      success: true,
      payload: {
        status: 200,
        body: {},
        headers: { 'content-type': 'application/json' },
      },
    });
  });

  it('returns valid attachment API envelopes through the Forge sandbox bridge', async () => {
    const listResponse = await callSandboxBridge('fetchProduct', {
      restPath: '/wiki/api/v2/pages/local-dev-page/attachments?filename=diagram.png',
      fetchRequestInit: { method: 'GET' },
    }) as { body: string };
    expect(JSON.parse(listResponse.body)).toEqual({ results: [] });

    const uploadResponse = await callSandboxBridge('fetchProduct', {
      restPath: '/wiki/rest/api/content/local-dev-page/child/attachment',
      fetchRequestInit: { method: 'POST' },
    }) as { body: string };
    expect(JSON.parse(uploadResponse.body)).toEqual({
      results: [{ id: 'local-dev-attachment' }],
    });
  });

  it('fails loudly for unsupported bridge methods', async () => {
    await expect(callSandboxBridge('unsupportedMethod', {}))
      .rejects.toThrow('Unsupported sandbox Forge bridge method "unsupportedMethod"');
  });
});
