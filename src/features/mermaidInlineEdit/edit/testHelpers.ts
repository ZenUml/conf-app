/** Test-only helpers: hand-built source maps and the official mermaid parser. */
import mermaid from 'mermaid';
import type { Range, SequenceSourceMap } from '../types';

/** Range of the nth (0-based) occurrence of `text` in `code`. */
export function findRange(code: string, text: string, nth = 0): Range {
  let from = 0;
  let at = -1;
  for (let i = 0; i <= nth; i++) {
    at = code.indexOf(text, from);
    if (at < 0) throw new Error(`fixture: "${text}" occurrence ${nth} not found`);
    from = at + 1;
  }
  return [at, at + text.length];
}

/** Every whole-word occurrence of an actor id (not part of a longer word). */
export function idOccurrences(code: string, id: string): Range[] {
  const out: Range[] = [];
  const escaped = id.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'g');
  for (const m of code.matchAll(re)) out.push([m.index!, m.index! + id.length]);
  return out;
}

export interface MapSpec {
  /** actor id -> its id occurrences (default: all whole-word hits) and optional alias text. */
  participants: Record<string, { ids?: Range[]; alias?: string; aliasNth?: number } | undefined>;
  /** message index -> text to find (nth occurrence), or null for no editable text. */
  messages?: Record<number, { text: string; nth?: number } | { at: Range } | null>;
}

export function buildMap(code: string, spec: MapSpec): SequenceSourceMap {
  const participants = new Map<string, { labelRanges: Range[]; idRanges: Range[]; hasAlias: boolean }>();
  for (const [id, p] of Object.entries(spec.participants)) {
    const idRanges = p?.ids ?? idOccurrences(code, id);
    const hasAlias = p?.alias !== undefined;
    const labelRanges = hasAlias ? [findRange(code, p!.alias!, p!.aliasNth ?? 0)] : idRanges;
    participants.set(id, { labelRanges, idRanges, hasAlias });
  }
  const messages = new Map<number, { textRange: Range | null }>();
  for (const [index, m] of Object.entries(spec.messages ?? {})) {
    if (m === null) messages.set(Number(index), { textRange: null });
    else if ('at' in m) messages.set(Number(index), { textRange: m.at });
    else messages.set(Number(index), { textRange: findRange(code, m.text, m.nth ?? 0) });
  }
  return { code, participants, messages, notes: new Map() };
}

export interface OfficialDb {
  actors: Array<[id: string, description: string]>;
  messages: Array<{ from?: string; to?: string; message: string }>;
}

let initialized = false;

/** Parses with official mermaid and returns the sequence db; throws on a parse error. */
export async function officialDb(code: string): Promise<OfficialDb> {
  if (!initialized) {
    mermaid.initialize({ startOnLoad: false });
    initialized = true;
  }
  const diagram: any = await (mermaid as any).mermaidAPI.getDiagramFromText(code);
  const actors = [...diagram.db.getActors().entries()].map(
    ([id, a]: [string, { description: string }]) => [id, a.description] as [string, string],
  );
  const messages = diagram.db
    .getMessages()
    .map((m: { from?: string; to?: string; message: string }) => ({ from: m.from, to: m.to, message: m.message }));
  return { actors, messages };
}

/** Asserts that only the given ranges differ: segments between them are identical. */
export function expectOnlyRangesChanged(before: string, after: string, ranges: Range[], replacement: string): void {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  let pos = 0;
  let expected = '';
  for (const [s, e] of sorted) {
    expected += before.slice(pos, s) + replacement;
    pos = e;
  }
  expected += before.slice(pos);
  if (after !== expected) {
    throw new Error(`bytes outside the replaced ranges changed\nexpected: ${JSON.stringify(expected)}\nactual:   ${JSON.stringify(after)}`);
  }
}
