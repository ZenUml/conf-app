/** Test-only: checks a source map against every rule of the contract, using the official db. */
import { expect } from 'vitest';
import mermaid from 'mermaid';
import type { Range, SequenceSourceMap } from '../types';
import { getSourceMap } from './getSourceMap';

const NOTE = 2;

/**
 * What the db stores for a source slice: Mermaid's cleanupText rewrites
 * `="x"` to `='x'` inside tags, and encodeEntities rewrites `#35;` codes.
 */
export const encodeEntities = (s: string) =>
  s
    .replace(/<(\w+)([^>]*)>/g, (_m, tag, attrs) => '<' + tag + attrs.replace(/="([^"]*)"/g, "='$1'") + '>')
    .replace(/#\w+;/g, (e) => {
      const inner = e.slice(1, -1);
      return (/^\+?\d+$/.test(inner) ? '\uFB02\xB0\xB0' : '\uFB02\xB0') + inner + '\xB6\xDF';
    });

export const slice = (code: string, [s, e]: Range) => code.slice(s, e);

export async function official(code: string) {
  const { loadMermaid } = await import('@/utils/mermaid/loadMermaid');
  await loadMermaid();
  const diagram: any = await mermaid.mermaidAPI.getDiagramFromText(code);
  return diagram.db;
}

/** Checks every invariant of the contract against the official db and returns the map. */
export async function expectMap(code: string): Promise<SequenceSourceMap> {
  let reason = '';
  const map = await getSourceMap(code, { onReject: (r) => (reason = r) });
  expect(map, `source map (${reason})`).not.toBeNull();
  const db = await official(code);
  const records: any[] = db.getMessages();

  const messageIds = records.flatMap((r, i) => (r.to !== undefined && r.type !== NOTE ? [i] : []));
  const noteIds = records.flatMap((r, i) => (r.type === NOTE ? [i] : []));
  expect([...map!.messages.keys()].sort((a, b) => a - b)).toEqual(messageIds);
  expect([...map!.notes.keys()].sort((a, b) => a - b)).toEqual(noteIds);

  const seen = new Set<string>();
  for (const [index, { textRange }] of [...map!.messages, ...map!.notes]) {
    expect(textRange).not.toBeNull();
    expect(encodeEntities(slice(code, textRange!))).toBe(records[index].message);
    const key = textRange!.join(':');
    // Two records never share a non-empty range.
    if (textRange![0] !== textRange![1]) expect(seen.has(key)).toBe(false);
    seen.add(key);
  }

  expect([...map!.participants.keys()]).toEqual(db.getActorKeys());
  for (const [id, loc] of map!.participants) {
    expect(loc.idRanges.length).toBeGreaterThan(0);
    for (const r of loc.idRanges) expect(slice(code, r)).toBe(id);
    const description = db.getActor(id).description;
    if (!loc.hasAlias) {
      expect(loc.labelRanges).toEqual(loc.idRanges);
      expect(description).toBe(id);
    } else {
      for (const r of loc.labelRanges) expect(encodeEntities(slice(code, r))).toBe(description);
    }
  }
  return map!;
}

