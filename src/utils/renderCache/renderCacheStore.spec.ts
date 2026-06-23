import { describe, it, expect, beforeEach } from 'vitest';
import { getCachedSvg, putCachedSvg, isCacheableSvg, _resetForTesting } from './renderCacheStore';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';

describe('renderCacheStore (back-catalog view-time cache)', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetForTesting();
  });

  it('round-trips an SVG by source', () => {
    expect(putCachedSvg('graph-source-A', SVG)).toBeNull();
    expect(getCachedSvg('graph-source-A')).toBe(SVG);
  });

  it('returns undefined on a miss', () => {
    expect(getCachedSvg('never-stored')).toBeUndefined();
  });

  it('keys by source content — different source ⇒ different (or absent) entry', () => {
    putCachedSvg('source-A', SVG);
    expect(getCachedSvg('source-B')).toBeUndefined();
    const other = '<svg id="b"><circle/></svg>';
    putCachedSvg('source-B', other);
    expect(getCachedSvg('source-A')).toBe(SVG);
    expect(getCachedSvg('source-B')).toBe(other);
  });

  it('refuses to cache oversized SVGs (quota guard)', () => {
    const huge = '<svg>' + 'x'.repeat(300 * 1024) + '</svg>';
    expect(putCachedSvg('big', huge)).toBe('oversized');
    expect(getCachedSvg('big')).toBeUndefined();
  });

  it('refuses non-SVG content', () => {
    expect(putCachedSvg('notsvg', '<div>nope</div>')).toBe('unsupported');
    expect(putCachedSvg('empty', '')).toBe('unsupported');
    expect(putCachedSvg('null', null)).toBe('unsupported');
  });

  it('evicts the oldest entries past the cap (LRU), keeping recents', () => {
    for (let i = 0; i < 30; i++) putCachedSvg('src-' + i, `<svg id="${i}">${i}</svg>`);
    // cap is 24 → the first 6 (0..5) should be evicted, the last 24 (6..29) kept.
    expect(getCachedSvg('src-0')).toBeUndefined();
    expect(getCachedSvg('src-5')).toBeUndefined();
    expect(getCachedSvg('src-6')).toBe('<svg id="6">6</svg>');
    expect(getCachedSvg('src-29')).toBe('<svg id="29">29</svg>');
  });

  it('a get() promotes recency so the entry survives later eviction (LRU)', () => {
    for (let i = 0; i < 24; i++) putCachedSvg('k-' + i, `<svg id="${i}">${i}</svg>`);
    // Touch the oldest so it becomes most-recent.
    expect(getCachedSvg('k-0')).toBeTruthy();
    // Add one more → eviction removes the now-oldest (k-1), NOT the promoted k-0.
    putCachedSvg('k-new', '<svg id="new">n</svg>');
    expect(getCachedSvg('k-0')).toBeTruthy();
    expect(getCachedSvg('k-1')).toBeUndefined();
  });

  it('isCacheableSvg gates on shape and size', () => {
    expect(isCacheableSvg(SVG)).toBe(true);
    expect(isCacheableSvg('<div/>')).toBe(false);
    expect(isCacheableSvg('')).toBe(false);
    expect(isCacheableSvg(undefined)).toBe(false);
    expect(isCacheableSvg('<svg>' + 'x'.repeat(300 * 1024) + '</svg>')).toBe(false);
  });
});
