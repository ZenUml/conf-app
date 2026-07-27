import { describe, it, expect } from 'vitest';
import { parseEmbedDeeplink } from './embedDeeplink';

const CLOUD = '494a0c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

describe('parseEmbedDeeplink', () => {
  it('parses a canonical deeplink', () => {
    expect(parseEmbedDeeplink(`https://confluence.zenuml.com/d/${CLOUD}/123456789`))
      .toEqual({ cloudId: CLOUD, contentId: '123456789' });
  });

  it('tolerates trailing slash, query and fragment', () => {
    expect(parseEmbedDeeplink(`https://confluence.zenuml.com/d/${CLOUD}/42/?utm=x#top`))
      .toEqual({ cloudId: CLOUD, contentId: '42' });
  });

  it('rejects http, foreign hosts, and malformed paths', () => {
    expect(parseEmbedDeeplink(`http://confluence.zenuml.com/d/${CLOUD}/42`)).toBeUndefined();
    expect(parseEmbedDeeplink(`https://evil.example.com/d/${CLOUD}/42`)).toBeUndefined();
    expect(parseEmbedDeeplink('https://confluence.zenuml.com/d/42')).toBeUndefined();
    expect(parseEmbedDeeplink(`https://confluence.zenuml.com/d/${CLOUD}/not-numeric`)).toBeUndefined();
    expect(parseEmbedDeeplink('')).toBeUndefined();
  });
});
