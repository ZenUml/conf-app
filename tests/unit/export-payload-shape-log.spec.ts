import { describe, it, expect, vi } from 'vitest';

vi.mock('@forge/api', () => ({
  default: { asApp: () => ({ requestConfluence: vi.fn() }), asUser: () => ({ requestConfluence: vi.fn() }) },
  route: (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), ''),
  routeFromAbsolute: (url: string) => url,
}));

import { redactPayloadShape } from '../../src/export.js';

// #554: the diagnostic exists to name the caller behind `exportType: 'other'`.
// It runs on customer traffic, so the contract that matters is what it does NOT
// copy into the app log.
describe('redactPayloadShape (#554 diagnostic)', () => {
  it('keeps object structure so an unknown caller is identifiable', () => {
    expect(redactPayloadShape({ exportType: 'other', context: { cloudId: 'abc' } })).toEqual({
      exportType: 'other',
      context: { cloudId: 'abc' },
    });
  });

  it('keeps short strings — an app key or module key is the signal we want', () => {
    expect(redactPayloadShape({ appKey: 'com.example.scroll-exporter' })).toEqual({
      appKey: 'com.example.scroll-exporter',
    });
  });

  it('collapses a long string to its length, never its content', () => {
    const diagram = 'A->B: hello\n'.repeat(50);
    const out = redactPayloadShape({ source: diagram }) as { source: string };
    expect(out.source).toBe(`String(${diagram.length})`);
    expect(out.source).not.toContain('hello');
  });

  it('reduces a content-bearing key to its key names only', () => {
    const out = redactPayloadShape({
      extension: { parameters: { title: 'Q3 revenue plan', diagram: 'A->B' } },
    }) as { extension: { parameters: { _keys: string[] } } };
    expect(out.extension.parameters).toEqual({ _keys: ['title', 'diagram'] });
    expect(JSON.stringify(out)).not.toContain('Q3 revenue plan');
  });

  it('samples an array rather than copying it whole', () => {
    const out = redactPayloadShape({ items: [1, 2, 3, 4, 5] }) as {
      items: { _len: number; _sample: unknown[] };
    };
    expect(out.items._len).toBe(5);
    expect(out.items._sample).toEqual([1, 2]);
  });

  it('stops recursing at depth 4 so a deep payload cannot flood the log', () => {
    const deep = { a: { b: { c: { d: { e: { f: 1 } } } } } };
    expect(JSON.stringify(redactPayloadShape(deep))).toContain('Object(1)');
  });

  it('returns null for null and undefined', () => {
    expect(redactPayloadShape(null)).toBeNull();
    expect(redactPayloadShape(undefined)).toBeNull();
  });
});
