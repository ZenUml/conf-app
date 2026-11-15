import { describe, it, expect } from 'vitest';
import { decodeRevision, encodeRevision, hashSource, MAX_REVISION_CHARS } from './renderRevision';

describe('render_diagram revision token', () => {
  it('round-trips the chain state', async () => {
    const h = await hashSource('A->B: hi');
    const token = encodeRevision({ n: 2, h, c: ['group_with_messages'], f: h });
    expect(token.startsWith('r1.')).toBe(true);
    expect(token.length).toBeLessThan(MAX_REVISION_CHARS);
    expect(decodeRevision(token)).toEqual({ status: 'valid', state: { n: 2, h, c: ['group_with_messages'], f: h } });
  });

  it('hashes the source to 16 hex characters, the same every time', async () => {
    const a = await hashSource('A->B: hi');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(await hashSource('A->B: hi')).toBe(a);
    expect(await hashSource('A->B: ho')).not.toBe(a);
  });

  it('reports a missing revision as none', () => {
    expect(decodeRevision(undefined)).toEqual({ status: 'none' });
    expect(decodeRevision('')).toEqual({ status: 'none' });
  });

  const bad: Array<[string, unknown]> = [
    ['not a string', 42],
    ['wrong prefix', 'r2.eyJuIjoxfQ'],
    ['not base64 JSON', 'r1.%%%'],
    ['attempt out of range', `r1.${Buffer.from(JSON.stringify({ n: 0, h: '0123456789abcdef', c: [] })).toString('base64url')}`],
    ['hash not hex', `r1.${Buffer.from(JSON.stringify({ n: 1, h: 'zz', c: [] })).toString('base64url')}`],
    ['unknown issue code', `r1.${Buffer.from(JSON.stringify({ n: 1, h: '0123456789abcdef', c: ['made_up'] })).toString('base64url')}`],
    ['too long', `r1.${'a'.repeat(MAX_REVISION_CHARS)}`],
  ];
  for (const [name, token] of bad) {
    it(`rejects ${name} as invalid, never throwing`, () => {
      expect(decodeRevision(token)).toEqual({ status: 'invalid' });
    });
  }
});
