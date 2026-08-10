import { describe, it, expect } from 'vitest';
import { parseEmbedDeeplink, deeplinkHostForProductType, buildEmbedDeeplink } from './embedDeeplink';

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

  // asyncapi deeplinks are deferred — its viewer doesn't route through
  // GenericViewer, so there is no host to mint against yet.
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
