import { describe, it, expect } from 'vitest';
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
  it('exports the canonical title', () => {
    expect(DEMO_PAGE_TITLE).toBe('Welcome to Diagramly — Try it out');
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
