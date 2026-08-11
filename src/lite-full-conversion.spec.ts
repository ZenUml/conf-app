import { describe, it, expect } from 'vitest';
import {
  parseExtensionKey,
  mapLiteMacroKey,
  fullContentTypeForMacroKey,
  collectLiteExtensions,
  rewriteExtensionNode,
  LITE_APP_ID,
  type AdfExtensionNode,
} from './lite-full-conversion';

// Captured live from lite-stg page 99876891 on 2026-08-11 (trimmed to the
// fields the converter touches plus the context blob it must preserve).
const LITE_ENV_ID = '5ea0d957-4b7d-47e5-b8cc-7d5fb4fc2338';
const capturedNode = (): AdfExtensionNode => ({
  type: 'extension',
  attrs: {
    layout: 'default',
    extensionType: 'com.atlassian.ecosystem',
    extensionKey: `${LITE_APP_ID}/${LITE_ENV_ID}/static/zenuml-sequence-macro-lite`,
    text: 'Diagram (Mermaid, PlantUML & ZenUML) Lite (Staging)',
    parameters: {
      layout: 'extension',
      guestParams: { customContentId: '99745817', updatedAt: '2026-06-02T09:14:39.358Z' },
      forgeEnvironment: 'STAGING',
      embeddedMacroContext: { accountId: 'x', cloudId: 'y' },
      localId: 'fb3d4d63-76fb-460c-9e9a-9fd8cbcbe1e6',
      extensionId: `ari:cloud:ecosystem::extension/${LITE_APP_ID}/${LITE_ENV_ID}/static/zenuml-sequence-macro-lite`,
      extensionTitle: 'Diagram (Mermaid, PlantUML & ZenUML) Lite (Staging)',
    },
    localId: 'fb3d4d63-76fb-460c-9e9a-9fd8cbcbe1e6',
  },
});

const FULL_APP = {
  appId: 'd9e4002b-120b-426b-834b-402a4a5adce7',
  environmentId: '11111111-2222-3333-4444-555555555555',
  environmentType: 'PRODUCTION',
};

describe('parseExtensionKey', () => {
  it('parses the captured Forge extension key', () => {
    expect(parseExtensionKey(capturedNode().attrs.extensionKey)).toEqual({
      appId: LITE_APP_ID,
      environmentId: LITE_ENV_ID,
      macroKey: 'zenuml-sequence-macro-lite',
    });
  });

  it('rejects Connect-era bare keys and foreign shapes', () => {
    expect(parseExtensionKey('zenuml-sequence-macro')).toBeNull();
    expect(parseExtensionKey(undefined)).toBeNull();
    expect(parseExtensionKey('a/b/static/c')).toBeNull();
  });
});

describe('mapLiteMacroKey', () => {
  it.each([
    ['zenuml-sequence-macro-lite', 'zenuml-sequence-macro'],
    ['zenuml-openapi-macro-lite', 'zenuml-openapi-macro'],
    ['zenuml-graph-macro-lite', 'zenuml-graph-macro'],
  ])('%s -> %s', (lite: string, full: string) => {
    expect(mapLiteMacroKey(lite)).toBe(full);
  });

  it('refuses embed (phase-2) and non-lite keys', () => {
    expect(mapLiteMacroKey('zenuml-embed-macro-lite')).toBeNull();
    expect(mapLiteMacroKey('zenuml-sequence-macro')).toBeNull();
    expect(mapLiteMacroKey('other-macro-lite')).toBeNull();
  });
});

describe('fullContentTypeForMacroKey', () => {
  it('routes graph to the graph content type, everything else to sequence', () => {
    expect(fullContentTypeForMacroKey('zenuml-graph-macro')).toBe(
      'ac:com.zenuml.confluence-addon:zenuml-content-graph',
    );
    expect(fullContentTypeForMacroKey('zenuml-sequence-macro')).toBe(
      'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
    );
    expect(fullContentTypeForMacroKey('zenuml-openapi-macro')).toBe(
      'ac:com.zenuml.confluence-addon:zenuml-content-sequence',
    );
  });
});

describe('collectLiteExtensions', () => {
  it('finds Lite nodes nested anywhere and ignores foreign extensions', () => {
    const foreign = {
      type: 'extension',
      attrs: {
        extensionType: 'com.atlassian.ecosystem',
        extensionKey: `${FULL_APP.appId}/${FULL_APP.environmentId}/static/zenuml-sequence-macro`,
      },
    };
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [] },
        { type: 'layoutSection', content: [{ type: 'layoutColumn', content: [capturedNode()] }] },
        foreign,
      ],
    };
    const found = collectLiteExtensions(doc);
    expect(found).toHaveLength(1);
    expect(found[0].attrs.extensionKey).toContain('zenuml-sequence-macro-lite');
  });
});

describe('rewriteExtensionNode', () => {
  it('swaps identity + pointer, preserves localId and context', () => {
    const node = capturedNode();
    rewriteExtensionNode(node, FULL_APP, 'zenuml-sequence-macro', '424242');

    const expectedPath = `${FULL_APP.appId}/${FULL_APP.environmentId}/static/zenuml-sequence-macro`;
    expect(node.attrs.extensionKey).toBe(expectedPath);
    expect(node.attrs.parameters!.extensionId).toBe(
      `ari:cloud:ecosystem::extension/${expectedPath}`,
    );
    expect(node.attrs.parameters!.guestParams!.customContentId).toBe('424242');
    expect(node.attrs.parameters!.forgeEnvironment).toBe('PRODUCTION');
    // Title loses the " Lite" infix but keeps the rest, including "(Staging)".
    expect(node.attrs.text).toBe('Diagram (Mermaid, PlantUML & ZenUML) (Staging)');
    // Identity that must survive:
    expect(node.attrs.localId).toBe('fb3d4d63-76fb-460c-9e9a-9fd8cbcbe1e6');
    expect(node.attrs.parameters!.localId).toBe('fb3d4d63-76fb-460c-9e9a-9fd8cbcbe1e6');
    expect(node.attrs.parameters!.embeddedMacroContext).toEqual({ accountId: 'x', cloudId: 'y' });
  });
});
