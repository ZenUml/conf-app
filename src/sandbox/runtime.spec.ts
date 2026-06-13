import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import forgeGlobal from '@/model/globals/forgeGlobal';
import { callSandboxBridge, installSandboxRuntime } from './runtime';

describe('sandbox runtime', () => {
  beforeEach(() => {
    localStorage.clear();
    history.replaceState(null, '', '/sandbox-app.html?sandbox=seq-edit');
  });

  afterEach(() => {
    delete (globalThis as any).__bridge;
    localStorage.clear();
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

  it('clears paywall mock state for ordinary sandbox presets', () => {
    localStorage.setItem('mockMacroCount', '105');
    localStorage.setItem('mockCSSEnabled', 'true');
    localStorage.setItem('mockSpacePaid', 'false');
    localStorage.setItem('mockSpaceKey', 'SD');
    localStorage.setItem('mockClientDomain', 'lite-stg');
    localStorage.setItem(
      'paywallContinueAttempts:lite-stg:SD:forge-sandbox-user',
      JSON.stringify({ remainingAttempts: 0 }),
    );

    installSandboxRuntime();

    expect(localStorage.getItem('mockMacroCount')).toBeNull();
    expect(localStorage.getItem('mockCSSEnabled')).toBeNull();
    expect(localStorage.getItem('mockSpacePaid')).toBeNull();
    expect(localStorage.getItem('mockSpaceKey')).toBeNull();
    expect(localStorage.getItem('mockClientDomain')).toBeNull();
    expect(localStorage.getItem(
      'paywallContinueAttempts:lite-stg:SD:forge-sandbox-user',
    )).toBeNull();
  });

  it('applies paywall mock state only for paywall presets', () => {
    history.replaceState(null, '', '/sandbox-app.html?sandbox=paywall-seq-edit');

    installSandboxRuntime();

    expect(localStorage.getItem('mockMacroCount')).toBe('105');
    expect(localStorage.getItem('mockCSSEnabled')).toBe('true');
    expect(localStorage.getItem('mockSpacePaid')).toBe('false');
    expect(localStorage.getItem('mockSpaceKey')).toBe('SD');
    expect(localStorage.getItem('mockClientDomain')).toBe('lite-stg');
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
