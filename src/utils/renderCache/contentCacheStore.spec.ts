import { describe, it, expect, beforeEach } from 'vitest';
import {
  getCachedContent,
  putCachedContent,
  removeCachedContent,
  hashContent,
  _resetForTesting,
  type ViewerContentIdentity,
  type ViewerContentMacroKind,
} from './contentCacheStore';

const DOC = JSON.stringify({ diagramType: 'sequence', code: 'A.b()' });
const identity = (
  cloudId: string,
  customContentId = 'cc-1',
  macroKind: ViewerContentMacroKind = 'sequence',
): ViewerContentIdentity => ({
  cloudId,
  customContentId,
  macroKind,
});

describe('contentCacheStore (SWR content cache, keyed by complete viewer identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetForTesting();
  });

  it('separates the same custom content id across cloud IDs', () => {
    const tenantA = identity('cloud-a');
    const tenantB = identity('cloud-b');

    expect(putCachedContent(tenantA, DOC)).toBe(true);
    expect(getCachedContent(tenantA)?.doc).toBe(DOC);
    expect(getCachedContent(tenantB)).toBeUndefined();
  });

  it('separates the same cloud and custom content id across macro kinds', () => {
    const graph = identity('cloud-a', 'cc-shared', 'graph');
    const openapi = identity('cloud-a', 'cc-shared', 'openapi');

    expect(putCachedContent(graph, DOC)).toBe(true);
    expect(getCachedContent(openapi)).toBeUndefined();
  });

  it('round-trips a doc by customContentId, with a change-detection hash', () => {
    const key = identity('cloud-a');
    expect(putCachedContent(key, DOC)).toBe(true);
    const got = getCachedContent(key);
    expect(got?.doc).toBe(DOC);
    expect(got?.hash).toBe(hashContent(DOC));
  });

  it('returns undefined on a miss', () => {
    expect(getCachedContent(identity('cloud-a', 'never'))).toBeUndefined();
  });

  it('removes one corrupt entry without clearing another identity', () => {
    const corrupt = identity('cloud-a', 'corrupt');
    const healthy = identity('cloud-a', 'healthy');
    putCachedContent(corrupt, '{not-json');
    putCachedContent(healthy, DOC);

    removeCachedContent(corrupt);

    expect(getCachedContent(corrupt)).toBeUndefined();
    expect(getCachedContent(healthy)?.doc).toBe(DOC);
  });

  it('keys by id — the hash changes when content changes (drives revalidate re-render)', () => {
    const key = identity('cloud-a');
    putCachedContent(key, DOC);
    const changed = JSON.stringify({ diagramType: 'sequence', code: 'A.b()\nC.d()' });
    expect(hashContent(changed)).not.toBe(getCachedContent(key)!.hash); // background fetch would see a different hash → re-render
  });

  it('refuses oversized docs (quota guard)', () => {
    const huge = JSON.stringify({ code: 'x'.repeat(300 * 1024) });
    const key = identity('cloud-a', 'big');
    expect(putCachedContent(key, huge)).toBe(false);
    expect(getCachedContent(key)).toBeUndefined();
  });

  it('refuses empty id / empty doc', () => {
    expect(putCachedContent(identity('cloud-a', ''), DOC)).toBe(false);
    expect(putCachedContent(identity('cloud-a'), '')).toBe(false);
  });

  it('does not read or write when the complete identity is unavailable', () => {
    expect(getCachedContent(undefined)).toBeUndefined();
    expect(putCachedContent(undefined, DOC)).toBe(false);
    expect(putCachedContent({
      cloudId: '',
      customContentId: 'cc-1',
      macroKind: 'sequence',
    }, DOC)).toBe(false);
  });

  it('ignores id-only entries from the v1 namespace', () => {
    localStorage.setItem('zenuml:ccache:cc-1', JSON.stringify({
      doc: DOC,
      hash: hashContent(DOC),
    }));

    expect(getCachedContent(identity('cloud-a'))).toBeUndefined();
  });

  it('evicts oldest past the cap (LRU)', () => {
    for (let i = 0; i < 40; i++) putCachedContent(identity('cloud-a', 'cc-' + i), JSON.stringify({ n: i }));
    // cap 32 → 0..7 evicted, 8..39 kept.
    expect(getCachedContent(identity('cloud-a', 'cc-0'))).toBeUndefined();
    expect(getCachedContent(identity('cloud-a', 'cc-7'))).toBeUndefined();
    expect(getCachedContent(identity('cloud-a', 'cc-8'))).toBeTruthy();
    expect(getCachedContent(identity('cloud-a', 'cc-39'))).toBeTruthy();
  });

  it('a get() promotes recency so the entry survives later eviction', () => {
    for (let i = 0; i < 32; i++) putCachedContent(identity('cloud-a', 'k-' + i), JSON.stringify({ n: i }));
    expect(getCachedContent(identity('cloud-a', 'k-0'))).toBeTruthy(); // touch oldest
    putCachedContent(identity('cloud-a', 'k-new'), JSON.stringify({ n: 'new' }));
    expect(getCachedContent(identity('cloud-a', 'k-0'))).toBeTruthy(); // promoted, survives
    expect(getCachedContent(identity('cloud-a', 'k-1'))).toBeUndefined(); // now-oldest evicted
  });
});
