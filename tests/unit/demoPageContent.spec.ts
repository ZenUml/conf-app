import { describe, it, expect } from 'vitest';
import { DEMO_PAGE_TITLE, DEMO_PAGE_ADF, MACRO_KEYS } from '../../src/demoPageContent';

describe('demoPageContent', () => {
  it('exports the canonical title', () => {
    expect(DEMO_PAGE_TITLE).toBe('Welcome to Diagramly — Try it out');
  });

  it('exports an ADF body whose top type is doc', () => {
    expect(DEMO_PAGE_ADF.type).toBe('doc');
    expect(DEMO_PAGE_ADF.version).toBe(1);
    expect(Array.isArray(DEMO_PAGE_ADF.content)).toBe(true);
  });

  it('parses cleanly when round-tripped through JSON', () => {
    const roundTrip = JSON.parse(JSON.stringify(DEMO_PAGE_ADF));
    expect(roundTrip).toEqual(DEMO_PAGE_ADF);
  });

  it('references all four macro keys', () => {
    const serialized = JSON.stringify(DEMO_PAGE_ADF);
    for (const key of MACRO_KEYS) {
      expect(serialized).toContain(key);
    }
  });

  it('macro keys match the diagramly-build manifest', () => {
    // The diagramly build is the lite-variant manifest with LITE_KEY_SUFFIX=''
    // and SEQUENCE_MACRO_KEY='gpt-diagram-macro' (see package.json forge:deploy:diagramly:*).
    expect(MACRO_KEYS).toEqual([
      'gpt-diagram-macro',
      'zenuml-graph-macro',
      'zenuml-openapi-macro',
      'zenuml-embed-macro',
    ]);
  });
});
