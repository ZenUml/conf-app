import { describe, it, expect } from 'vitest';
import { parseEmbedDeeplink } from './embedDeeplink';

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
