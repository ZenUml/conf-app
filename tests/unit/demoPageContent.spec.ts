import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEMO_PAGE_TITLE,
  DIAGRAMLY_CUSTOM_CONTENT_TYPE,
  MACRO_KEYS,
  MACROS,
  buildDemoPageAdf,
} from '../../src/demoPageContent';

const FAKE_IDS = {
  sequence: '1001',
  mermaid: '1002',
  graph: '1003',
  openapi: '1004',
};

const FAKE_CTX = {
  appId: '01ede8b1-4e88-451a-b9ef-89eeef93afaf',
  environmentId: '8e7caf78-b9d2-499a-9450-9249f305f5f6',
  environmentType: 'DEVELOPMENT',
};

describe('demoPageContent', () => {
  it('exports the canonical title (falls back to Diagramly branding when no variant env is set)', () => {
    expect(DEMO_PAGE_TITLE).toBe('Welcome to Diagramly for Confluence — Try it out');
  });

  it('exports the diagramly custom-content type', () => {
    expect(DIAGRAMLY_CUSTOM_CONTENT_TYPE).toBe('ac:gptdock-confluence:gpt-custom-content-key');
  });

  it('declares one MACROS entry per demo section, each with a body and macroKey', () => {
    expect(MACROS.length).toBeGreaterThan(0);
    for (const m of MACROS as Array<any>) {
      expect(typeof m.id).toBe('string');
      expect(typeof m.macroKey).toBe('string');
      expect(typeof m.diagramType).toBe('string');
      expect(typeof m.contentTitle).toBe('string');
      expect(m.body).toBeTypeOf('object');
    }
    const ids = (MACROS as Array<any>).map(m => m.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
  });

  it('MACRO_KEYS exposes the unique macro keys used by MACROS', () => {
    const fromMacros = Array.from(new Set((MACROS as Array<any>).map(m => m.macroKey)));
    expect(new Set(MACRO_KEYS)).toEqual(new Set(fromMacros));
    expect(MACRO_KEYS).not.toContain('zenuml-embed-macro');
  });

  it('macro keys match the diagramly-build manifest (after CI strip)', () => {
    expect(new Set(MACRO_KEYS)).toEqual(
      new Set(['gpt-diagram-macro', 'zenuml-graph-macro', 'zenuml-openapi-macro']),
    );
  });
});

describe('buildDemoPageAdf', () => {
  it('returns an ADF doc whose top type is doc', () => {
    const adf = buildDemoPageAdf(FAKE_IDS, FAKE_CTX);
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    expect(Array.isArray(adf.content)).toBe(true);
  });

  it('renders one extension per MACROS entry, each carrying its customContentId as a string', () => {
    const adf = buildDemoPageAdf(FAKE_IDS, FAKE_CTX);
    const extensions = adf.content.filter((n: any) => n.type === 'extension');
    expect(extensions.length).toBe(MACROS.length);

    const idsInAdf = extensions
      .map((e: any) => e.attrs?.parameters?.guestParams?.customContentId)
      .filter(Boolean);
    expect(new Set(idsInAdf)).toEqual(new Set(Object.values(FAKE_IDS)));
  });

  it('uses Forge ARI extensionType + appId/envId-scoped extensionKey, NOT Connect-style', () => {
    const adf = buildDemoPageAdf(FAKE_IDS, FAKE_CTX);
    const extensions = adf.content.filter((n: any) => n.type === 'extension');
    for (const ext of extensions as Array<any>) {
      expect(ext.attrs.extensionType).toBe('com.atlassian.ecosystem');
      expect(ext.attrs.extensionType).not.toBe('com.atlassian.confluence.macro.core');

      const moduleKeyMatch = ext.attrs.extensionKey.match(
        /^([0-9a-f-]+)\/([0-9a-f-]+)\/static\/(.+)$/,
      );
      expect(moduleKeyMatch).not.toBeNull();
      const [, appIdInKey, envIdInKey, moduleKey] = moduleKeyMatch!;
      expect(appIdInKey).toBe(FAKE_CTX.appId);
      expect(envIdInKey).toBe(FAKE_CTX.environmentId);
      expect(MACRO_KEYS).toContain(moduleKey);

      // Forge required parameters
      expect(ext.attrs.parameters.extensionId).toBe(
        `ari:cloud:ecosystem::extension/${ext.attrs.extensionKey}`,
      );
      expect(ext.attrs.parameters.layout).toBe('extension');
      expect(ext.attrs.parameters.forgeEnvironment).toBe(FAKE_CTX.environmentType);
      expect(typeof ext.attrs.parameters.localId).toBe('string');
      expect(typeof ext.attrs.parameters.guestParams.customContentId).toBe('string');
      expect(typeof ext.attrs.parameters.guestParams.updatedAt).toBe('string');
    }
  });

  it('throws when a macro id has no customContentId', () => {
    const partial = { sequence: '1', mermaid: '2', graph: '3' }; // openapi missing
    expect(() => buildDemoPageAdf(partial, FAKE_CTX)).toThrow(/openapi/);
  });

  it('throws when forgeContext is missing appId / environmentId / environmentType', () => {
    expect(() => buildDemoPageAdf(FAKE_IDS, undefined as any)).toThrow(/forgeContext/);
    expect(() => buildDemoPageAdf(FAKE_IDS, { appId: '', environmentId: 'e', environmentType: 'DEVELOPMENT' } as any)).toThrow(/forgeContext/);
    expect(() => buildDemoPageAdf(FAKE_IDS, { appId: 'a', environmentId: '', environmentType: 'DEVELOPMENT' } as any)).toThrow(/forgeContext/);
    expect(() => buildDemoPageAdf(FAKE_IDS, { appId: 'a', environmentId: 'e', environmentType: '' } as any)).toThrow(/forgeContext/);
  });

  it('does NOT reference zenuml-embed-macro (stripped from diagramly build by CI)', () => {
    const adf = buildDemoPageAdf(FAKE_IDS, FAKE_CTX);
    expect(JSON.stringify(adf)).not.toContain('zenuml-embed-macro');
  });

  it('parses cleanly when round-tripped through JSON', () => {
    const adf = buildDemoPageAdf(FAKE_IDS, FAKE_CTX);
    expect(JSON.parse(JSON.stringify(adf))).toEqual(adf);
  });
});

// task 6: demoPageContent.js originally hardcoded Diagramly's own branding
// (custom-content type, macro keys, page title, in-body copy). Get Started
// (task 7) now reuses the same pipeline for lite and full, so every one of
// those values must come from the calling variant's own manifest env
// (process.env.CONNECT_KEY / CUSTOM_CONTENT_KEY / APP_LABEL / SEQUENCE_MACRO_KEY
// / LITE_KEY_SUFFIX — the same mechanism src/page-capture.js already uses),
// not be hardcoded to Diagramly. Module-scope constants read process.env
// once at import time, so proving this requires a real module reload with
// the env stubbed — vi.resetModules() + a fresh dynamic import.
describe('variant-correct branding (lite)', () => {
  const LITE_ENV = {
    CONNECT_KEY: 'com.zenuml.confluence-addon-lite',
    CUSTOM_CONTENT_KEY: 'zenuml-content-sequence',
    APP_LABEL: 'ZenUML for Confluence Lite',
    SEQUENCE_MACRO_KEY: 'zenuml-sequence-macro-lite',
    LITE_KEY_SUFFIX: '-lite',
  };
  const ORIGINAL_ENV: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of Object.keys(LITE_ENV)) {
      ORIGINAL_ENV[key] = process.env[key];
      process.env[key] = (LITE_ENV as Record<string, string>)[key];
    }
    vi.resetModules();
  });

  afterEach(() => {
    for (const key of Object.keys(LITE_ENV)) {
      if (ORIGINAL_ENV[key] === undefined) delete process.env[key];
      else process.env[key] = ORIGINAL_ENV[key];
    }
    vi.resetModules();
  });

  it('computes the Lite custom-content type and page title from Lite env, not Diagramly', async () => {
    const lite = await import('../../src/demoPageContent');
    expect(lite.APP_LABEL).toBe('ZenUML for Confluence Lite');
    expect(lite.DEMO_PAGE_TITLE).toBe('Welcome to ZenUML for Confluence Lite — Try it out');
    expect(lite.CUSTOM_CONTENT_TYPE).toBe('ac:com.zenuml.confluence-addon-lite:zenuml-content-sequence');
    expect(lite.CUSTOM_CONTENT_TYPE).not.toBe(DIAGRAMLY_CUSTOM_CONTENT_TYPE);
  });

  it('uses the Lite macro keys (zenuml-*-macro-lite), not the Diagramly gpt-* keys', async () => {
    const lite = await import('../../src/demoPageContent');
    expect(new Set(lite.MACRO_KEYS)).toEqual(
      new Set(['zenuml-sequence-macro-lite', 'zenuml-graph-macro-lite', 'zenuml-openapi-macro-lite']),
    );
    expect(lite.MACRO_KEYS).not.toContain('gpt-diagram-macro');
  });

  it('the generated ADF carries Lite branding in its copy and never the word "Diagramly"', async () => {
    const lite = await import('../../src/demoPageContent');
    const idToContentId: Record<string, string> = {};
    for (const m of lite.MACROS as Array<any>) idToContentId[m.id] = `id-${m.id}`;
    const adf = lite.buildDemoPageAdf(idToContentId, FAKE_CTX);
    const json = JSON.stringify(adf);
    expect(json).toContain('ZenUML for Confluence Lite');
    expect(json).not.toContain('Diagramly');
  });
});
