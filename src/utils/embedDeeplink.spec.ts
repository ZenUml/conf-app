import { describe, it, expect } from 'vitest';
import {
  parseEmbedDeeplink,
  deeplinkHostForProductType,
  buildEmbedDeeplink,
  resolveLocalContentId,
  newlyCreatedId,
  buildDiagramDeeplink,
  parseDiagramDeeplink,
  resolveLocalTypedContentId,
} from './embedDeeplink';

const CLOUD = '494a0c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

describe('parseEmbedDeeplink', () => {
  it.each([
    ['legacy Worker host', 'confluence.zenuml.com'],
    ['lite/diagramly host', 'conf-lite.zenuml.com'],
    ['full host', 'conf-full.zenuml.com'],
  ])('parses a canonical deeplink on the %s', (_label, host) => {
    expect(parseEmbedDeeplink(`https://${host}/d/${CLOUD}/123456789`))
      .toEqual({ cloudId: CLOUD, contentId: '123456789' });
  });

  it('tolerates trailing slash, query and fragment', () => {
    expect(parseEmbedDeeplink(`https://conf-lite.zenuml.com/d/${CLOUD}/42/?utm=x#top`))
      .toEqual({ cloudId: CLOUD, contentId: '42' });
  });

  it('rejects http, foreign hosts (incl. staging hosts), and malformed paths', () => {
    expect(parseEmbedDeeplink(`http://conf-lite.zenuml.com/d/${CLOUD}/42`)).toBeUndefined();
    expect(parseEmbedDeeplink(`https://evil.example.com/d/${CLOUD}/42`)).toBeUndefined();
    // Staging hosts are NOT accepted — see the file-level design note.
    expect(parseEmbedDeeplink(`https://conf-stg-lite.zenuml.com/d/${CLOUD}/42`)).toBeUndefined();
    expect(parseEmbedDeeplink('https://conf-lite.zenuml.com/d/42')).toBeUndefined();
    expect(parseEmbedDeeplink(`https://conf-lite.zenuml.com/d/${CLOUD}/not-numeric`)).toBeUndefined();
    expect(parseEmbedDeeplink('')).toBeUndefined();
  });
});

describe('deeplinkHostForProductType', () => {
  it.each([
    ['lite', 'conf-lite.zenuml.com'],
    ['diagramly', 'conf-lite.zenuml.com'],
    ['full', 'conf-full.zenuml.com'],
  ])('maps product type %s to host %s', (productType, expectedHost) => {
    expect(deeplinkHostForProductType(productType)).toBe(expectedHost);
  });

  // No asyncapi row: this is the per-VARIANT host for the bare 3-segment embed
  // link, and the asyncapi variant's viewer doesn't route through GenericViewer,
  // so there is no host to mint against. Unrelated to the 4-segment TYPED
  // `/d/asyncapi/...` link below, which Lite does mint from the byline — that
  // one is keyed on diagram type and always uses confluence.zenuml.com.
  // Mixed-arity rows ([string, string] | [undefined, string]) need an
  // explicit tuple type — otherwise vitest/TS infers a union of fixed-length
  // tuples and a single-parameter callback can't satisfy both arities
  // (TS2345, caught by plain `tsc`; vue-tsc itself can't run in this
  // checkout — 1.8.27 is incompatible with the resolved typescript@5.9.3).
  it.each<[string | undefined, string]>([
    ['asyncapi', 'no deeplink host is defined for it yet'],
    [undefined, 'no product type is unresolved at build time'],
    ['unknown', 'an unrecognised product type must fail closed, not fall back to a default host'],
  ])('returns undefined for %s (%s)', (productType) => {
    expect(deeplinkHostForProductType(productType)).toBeUndefined();
  });
});

describe('buildEmbedDeeplink', () => {
  it('builds the bare deeplink URL — no ticket, no query params', () => {
    expect(buildEmbedDeeplink('conf-lite.zenuml.com', CLOUD, '123456789'))
      .toBe(`https://conf-lite.zenuml.com/d/${CLOUD}/123456789`);
  });

  it('round-trips through parseEmbedDeeplink for every mapped host', () => {
    for (const host of ['conf-lite.zenuml.com', 'conf-full.zenuml.com']) {
      const url = buildEmbedDeeplink(host, CLOUD, '42');
      expect(parseEmbedDeeplink(url)).toEqual({ cloudId: CLOUD, contentId: '42' });
    }
  });
});

describe('resolveLocalContentId', () => {
  it('resolves a link minted for this site', () => {
    expect(resolveLocalContentId(`https://conf-lite.zenuml.com/d/${CLOUD}/42`, CLOUD)).toBe('42');
  });

  it('compares cloudId case-insensitively', () => {
    expect(resolveLocalContentId(`https://conf-lite.zenuml.com/d/${CLOUD.toUpperCase()}/42`, CLOUD))
      .toBe('42');
  });

  it('refuses a link from another site — ids are per-site integers', () => {
    const foreign = '11111111-2222-3333-4444-555555555555';
    expect(resolveLocalContentId(`https://conf-lite.zenuml.com/d/${foreign}/42`, CLOUD))
      .toBeUndefined();
  });

  it('is undefined with no cloudId, a non-string, or a non-deeplink', () => {
    expect(resolveLocalContentId(`https://conf-lite.zenuml.com/d/${CLOUD}/42`, undefined))
      .toBeUndefined();
    expect(resolveLocalContentId(undefined, CLOUD)).toBeUndefined();
    expect(resolveLocalContentId('https://example.com/', CLOUD)).toBeUndefined();
  });
});

describe('newlyCreatedId', () => {
  it('finds the id that appeared while the modal was open', () => {
    expect(newlyCreatedId(['1', '2'], ['1', '2', '3'])).toBe('3');
  });

  it('takes the last of several — a double save leaves the user on the newest', () => {
    expect(newlyCreatedId(['1'], ['1', '2', '3'])).toBe('3');
  });

  it('is undefined when nothing was created', () => {
    expect(newlyCreatedId(['1', '2'], ['1', '2'])).toBeUndefined();
    expect(newlyCreatedId([], [])).toBeUndefined();
  });

  it('ignores order — identity is by id, not position', () => {
    expect(newlyCreatedId(['1', '2'], ['2', '9', '1'])).toBe('9');
  });
});

describe('typed diagram deeplinks', () => {
  it('mints a 4-segment link per supported type', () => {
    for (const type of ['sequence', 'mermaid', 'plantuml', 'graph', 'openapi', 'asyncapi']) {
      expect(buildDiagramDeeplink(type, CLOUD, '42'))
        .toBe(`https://confluence.zenuml.com/d/${type}/${CLOUD}/42`);
    }
  });

  // Minting must stay on the host the typed autoConvert matchers in
  // manifest.yml list, or a pasted link silently fails to convert.
  it('mints on the host the manifest matchers are written against', () => {
    expect(buildDiagramDeeplink('graph', CLOUD, '42'))
      .toContain('https://confluence.zenuml.com/');
  });

  it('refuses an unknown type or missing parts', () => {
    expect(buildDiagramDeeplink('embed', CLOUD, '42')).toBeUndefined();
    expect(buildDiagramDeeplink('graph', '', '42')).toBeUndefined();
    expect(buildDiagramDeeplink('graph', CLOUD, '')).toBeUndefined();
  });

  // The Lite byline's AsyncAPI tile mints this form; without it the created
  // diagram has no link that places it on the page (ADR-0005 Option A).
  it('round-trips the asyncapi type the Lite byline mints', () => {
    const link = buildDiagramDeeplink('asyncapi', CLOUD, '42');
    expect(link).toBe(`https://confluence.zenuml.com/d/asyncapi/${CLOUD}/42`);
    expect(parseDiagramDeeplink(link)).toEqual({ type: 'asyncapi', cloudId: CLOUD, contentId: '42' });
  });

  it('round-trips, and parses on every migrated host', () => {
    for (const host of ['confluence', 'conf-lite', 'conf-full']) {
      expect(parseDiagramDeeplink(`https://${host}.zenuml.com/d/graph/${CLOUD}/42`))
        .toEqual({ type: 'graph', cloudId: CLOUD, contentId: '42' });
    }
  });

  // The two forms are told apart by segment count alone: a matcher's * covers
  // exactly one segment, so /d/*/* can never swallow /d/<type>/*/*.
  it('does not confuse the 3-segment embed form with the 4-segment typed form', () => {
    expect(parseDiagramDeeplink(`https://conf-lite.zenuml.com/d/${CLOUD}/42`)).toBeUndefined();
    expect(parseEmbedDeeplink(`https://conf-lite.zenuml.com/d/graph/${CLOUD}/42`)).toBeUndefined();
  });

  it('rejects an unknown type segment, http, and foreign hosts', () => {
    expect(parseDiagramDeeplink(`https://conf-lite.zenuml.com/d/embed/${CLOUD}/42`))
      .toBeUndefined();
    expect(parseDiagramDeeplink(`http://conf-lite.zenuml.com/d/graph/${CLOUD}/42`)).toBeUndefined();
    expect(parseDiagramDeeplink(`https://evil.example.com/d/graph/${CLOUD}/42`)).toBeUndefined();
  });

  it('guards resolveLocalTypedContentId on cloudId', () => {
    const foreign = '11111111-2222-3333-4444-555555555555';
    expect(resolveLocalTypedContentId(`https://conf-lite.zenuml.com/d/graph/${CLOUD}/42`, CLOUD))
      .toBe('42');
    expect(resolveLocalTypedContentId(`https://conf-lite.zenuml.com/d/graph/${foreign}/42`, CLOUD))
      .toBeUndefined();
    expect(resolveLocalTypedContentId(`https://conf-lite.zenuml.com/d/graph/${CLOUD}/42`, undefined))
      .toBeUndefined();
  });
});
