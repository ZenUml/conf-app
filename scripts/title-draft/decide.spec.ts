import { describe, expect, it, vi } from 'vitest';
// @ts-expect-error plain .mjs module
import { decide } from './decide.mjs';

const ok = vi.fn(async () => undefined);
const draft = { decision: 'draft', kind: 'flowchart', confidence: 0.9, reason: 'clear process', mermaid: 'flowchart LR\nA-->B' };

describe('decide', () => {
  it('accepts a confident, parsable draft', async () => {
    expect(await decide(JSON.stringify(draft), 0.7, ok)).toEqual({ status: 'ready', mermaid: 'flowchart LR\nA-->B', kind: 'flowchart', confidence: 0.9 });
  });
  it('strips code fences before parsing', async () => {
    expect((await decide('```json\n' + JSON.stringify(draft) + '\n```', 0.7, ok)).status).toBe('ready');
    expect((await decide('```\n' + JSON.stringify(draft) + '\n```', 0.7, ok)).status).toBe('ready');
  });
  it('accepts confidence equal to the minimum', async () => {
    expect((await decide(JSON.stringify({ ...draft, confidence: 0.7 }), 0.7, ok)).status).toBe('ready');
  });
  it.each([
    ['unparsable JSON', 'not json', 'unparsable_json'],
    ['non-object JSON', '[1]', 'unparsable_json'],
    ['skip decision', JSON.stringify({ ...draft, decision: 'skip' }), 'skip'],
    ['low confidence', JSON.stringify({ ...draft, confidence: 0.69 }), 'low_confidence'],
    ['missing confidence', JSON.stringify({ ...draft, confidence: undefined }), 'low_confidence'],
    ['empty mermaid', JSON.stringify({ ...draft, mermaid: '  ' }), 'empty_mermaid'],
    ['missing mermaid', JSON.stringify({ ...draft, mermaid: undefined }), 'empty_mermaid'],
  ])('returns no_diagram for %s', async (_n, text, reason) => {
    expect(await decide(text, 0.7, ok)).toEqual({ status: 'no_diagram', reason });
  });
  it('returns no_diagram when mermaid parsing fails', async () => {
    const bad = vi.fn(async () => { throw new Error('Parse error'); });
    expect(await decide(JSON.stringify(draft), 0.7, bad)).toEqual({ status: 'no_diagram', reason: 'mermaid_parse_failed' });
  });
  it('does not parse mermaid when an earlier check fails', async () => {
    const spy = vi.fn(async () => undefined);
    await decide(JSON.stringify({ ...draft, confidence: 0.1 }), 0.7, spy);
    expect(spy).not.toHaveBeenCalled();
  });
});
