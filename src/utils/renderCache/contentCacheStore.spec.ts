import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedContent, putCachedContent, hashContent, _resetForTesting } from './contentCacheStore';

const DOC = JSON.stringify({ diagramType: 'sequence', code: 'A.b()' });

describe('contentCacheStore (SWR content cache, keyed by customContentId)', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetForTesting();
  });

  it('round-trips a doc by customContentId, with a change-detection hash', () => {
    expect(putCachedContent('cc-1', DOC)).toBe(true);
    const got = getCachedContent('cc-1');
    expect(got?.doc).toBe(DOC);
    expect(got?.hash).toBe(hashContent(DOC));
  });

  it('returns undefined on a miss', () => {
    expect(getCachedContent('never')).toBeUndefined();
  });

  it('keys by id — the hash changes when content changes (drives revalidate re-render)', () => {
    putCachedContent('cc-1', DOC);
    const changed = JSON.stringify({ diagramType: 'sequence', code: 'A.b()\nC.d()' });
    expect(hashContent(changed)).not.toBe(getCachedContent('cc-1')!.hash); // background fetch would see a different hash → re-render
  });

  it('refuses oversized docs (quota guard)', () => {
    const huge = JSON.stringify({ code: 'x'.repeat(300 * 1024) });
    expect(putCachedContent('big', huge)).toBe(false);
    expect(getCachedContent('big')).toBeUndefined();
  });

  it('refuses empty id / empty doc', () => {
    expect(putCachedContent('', DOC)).toBe(false);
    expect(putCachedContent('cc-1', '')).toBe(false);
  });

  it('evicts oldest past the cap (LRU)', () => {
    for (let i = 0; i < 40; i++) putCachedContent('cc-' + i, JSON.stringify({ n: i }));
    // cap 32 → 0..7 evicted, 8..39 kept.
    expect(getCachedContent('cc-0')).toBeUndefined();
    expect(getCachedContent('cc-7')).toBeUndefined();
    expect(getCachedContent('cc-8')).toBeTruthy();
    expect(getCachedContent('cc-39')).toBeTruthy();
  });

  it('a get() promotes recency so the entry survives later eviction', () => {
    for (let i = 0; i < 32; i++) putCachedContent('k-' + i, JSON.stringify({ n: i }));
    expect(getCachedContent('k-0')).toBeTruthy(); // touch oldest
    putCachedContent('k-new', JSON.stringify({ n: 'new' }));
    expect(getCachedContent('k-0')).toBeTruthy(); // promoted, survives
    expect(getCachedContent('k-1')).toBeUndefined(); // now-oldest evicted
  });
});
