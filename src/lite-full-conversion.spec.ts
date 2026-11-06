import { describe, it, expect } from 'vitest';
import {
  parseExtensionKey,
  mapLiteMacroKey,
  LITE_DISCOVERY_MACRO_KEYS,
  fullContentTypeForLiteType,
  collectLiteExtensions,
  rewriteExtensionNode,
  normalizeEnvironmentId,
  batchLimitFor,
  shouldRequeue,
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

  // Full ships no zenuml-asyncapi-macro (the full/diagramly manifestEdits strip
  // it). Converting would rewrite the ADF to a module Full cannot render and
  // republish the page with a broken macro, so the migration deliberately
  // leaves these on Lite. Delete this expectation when Full ships the macro.
  it('refuses asyncapi while Full has no AsyncAPI macro module', () => {
    expect(mapLiteMacroKey('zenuml-asyncapi-macro-lite')).toBeNull();
  });

  // The space sweep has no cursor: it relies on a page dropping out of the CQL
  // once its macros are converted. A discovery key that mapLiteMacroKey refuses
  // never drops out — it is re-read every tick, holds slots in the 25-page
  // batch, and a batch made entirely of such pages yields macrosConverted === 0,
  // which shouldRequeue reads as "done" while convertible pages remain.
  it('every discovery key is one mapLiteMacroKey can actually convert', () => {
    for (const key of LITE_DISCOVERY_MACRO_KEYS) {
      expect(mapLiteMacroKey(key)).not.toBeNull();
    }
  });

  it('refuses embed (phase-2) and non-lite keys', () => {
    expect(mapLiteMacroKey('zenuml-embed-macro-lite')).toBeNull();
    expect(mapLiteMacroKey('zenuml-sequence-macro')).toBeNull();
    expect(mapLiteMacroKey('other-macro-lite')).toBeNull();
  });
});

describe('fullContentTypeForLiteType', () => {
  // The app writes EVERY diagram type under zenuml-content-sequence
  // (ApWrapper2.getContentKey) — measured: 2103 of 2104 mirrored graph bodies.
  // Converted content must land under the same key its source used, so it is
  // indistinguishable from natively-saved content.
  it('swaps only the app prefix, keeping the source key', () => {
    expect(
      fullContentTypeForLiteType('ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence'),
    ).toBe('ac:com.zenuml.confluence-addon:zenuml-content-sequence');
    expect(
      fullContentTypeForLiteType('ac:com.zenuml.confluence-addon-lite:zenuml-content-graph'),
    ).toBe('ac:com.zenuml.confluence-addon:zenuml-content-graph');
  });

  it('returns null for a type that is not Lite, so the macro is skipped', () => {
    expect(fullContentTypeForLiteType('ac:com.zenuml.confluence-addon:zenuml-content-sequence')).toBeNull();
    expect(fullContentTypeForLiteType('ac:gptdock-confluence:gpt-custom-content-key')).toBeNull();
    expect(fullContentTypeForLiteType(null)).toBeNull();
    expect(fullContentTypeForLiteType('')).toBeNull();
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

describe('normalizeEnvironmentId', () => {
  // The FIT hands out the ARI form; the extensionKey needs the bare uuid.
  // Concatenating the ARI is what broke staging job c5a6d954 (2026-08-11).
  it('takes the trailing uuid out of an environment ARI', () => {
    expect(
      normalizeEnvironmentId(
        'ari:cloud:ecosystem::environment/d9e4002b-120b-426b-834b-402a4a5adce7/095a5f48-0aa4-48b6-b546-0535bcee7c8e',
      ),
    ).toBe('095a5f48-0aa4-48b6-b546-0535bcee7c8e');
  });

  it('passes a bare uuid through unchanged', () => {
    expect(normalizeEnvironmentId('095a5f48-0aa4-48b6-b546-0535bcee7c8e')).toBe(
      '095a5f48-0aa4-48b6-b546-0535bcee7c8e',
    );
  });

  it('returns empty for anything that is not uuid-shaped, so the job fails loudly', () => {
    expect(normalizeEnvironmentId('')).toBe('');
    expect(normalizeEnvironmentId('ari:cloud:ecosystem::environment/nope')).toBe('');
  });

  it('produces an extensionKey that parseExtensionKey accepts (round trip)', () => {
    const env = normalizeEnvironmentId(
      'ari:cloud:ecosystem::environment/d9e4002b-120b-426b-834b-402a4a5adce7/095a5f48-0aa4-48b6-b546-0535bcee7c8e',
    );
    const node = capturedNode();
    rewriteExtensionNode(node, { ...FULL_APP, environmentId: env }, 'zenuml-sequence-macro', '1');
    expect(parseExtensionKey(node.attrs.extensionKey)).toEqual({
      appId: FULL_APP.appId,
      environmentId: '095a5f48-0aa4-48b6-b546-0535bcee7c8e',
      macroKey: 'zenuml-sequence-macro',
    });
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

/**
 * A job larger than one batch used to report `done` after its first 25 pages
 * and never be claimed again — the rest of the tenant's macros stayed Lite
 * with nothing in the record saying so.
 */
describe('multi-batch jobs', () => {
  it('uses the per-job limit when set, the default otherwise', () => {
    expect(batchLimitFor({})).toBe(25);
    expect(batchLimitFor({ pageBatchLimit: null })).toBe(25);
    expect(batchLimitFor({ pageBatchLimit: 1 })).toBe(1);
    // Out-of-range overrides fall back rather than widen the batch.
    expect(batchLimitFor({ pageBatchLimit: 0 })).toBe(25);
    expect(batchLimitFor({ pageBatchLimit: 99 })).toBe(25);
  });

  it('asks for another tick when the batch filled and work was done', () => {
    expect(shouldRequeue({ pagesTotal: 25, macrosConverted: 40 }, 25)).toBe(true);
    expect(shouldRequeue({ pagesTotal: 1, macrosConverted: 2 }, 1)).toBe(true);
  });

  it('stops when the batch was short — nothing left to sweep', () => {
    expect(shouldRequeue({ pagesTotal: 24, macrosConverted: 40 }, 25)).toBe(false);
    expect(shouldRequeue({ pagesTotal: 0, macrosConverted: 0 }, 25)).toBe(false);
  });

  it('stops a full batch that converted nothing, so it cannot loop', () => {
    expect(shouldRequeue({ pagesTotal: 25, macrosConverted: 0 }, 25)).toBe(false);
  });
});
