/**
 * Position parser for Mermaid sequence diagrams.
 *
 * How positions are found, without matching any content:
 * 1. Mermaid's own `getDiagramFromText(code)` gives the official db and the
 *    exact string its parser saw (`diagram.text`).
 * 2. `toParserInput(code)` rebuilds that string with an offset map back to
 *    `code`. Any difference from `diagram.text` -> null.
 * 3. The upstream grammar plus `loc.patch` (generated/sequenceLocParser.js)
 *    parses the same string into a subclass of the official `SequenceDB`
 *    (reached as `diagram.db.constructor`, no chunk import). The subclass
 *    calls `super` for everything and only notes which db records each
 *    grammar object produced, and the token ranges the patch attached.
 * 4. Both dbs must agree record by record, and every range must slice to the
 *    db's own value; otherwise -> null (the diagram is read-only on canvas).
 */
import { loadMermaid } from '@/utils/mermaid/loadMermaid';
import { enqueueMermaid } from '@/utils/mermaid/mermaidQueue';
import type { ParticipantLocation, Range, SequenceSourceMap } from '../types';
import { toOriginalRange, toParserInput, type ParserInput as MappedText } from './preprocess';
import { actorIdRange, aliasTextRange, messageTextRange } from './textRange';

type Loc = [number, number];

interface Collected {
  /** actor id -> raw ACTOR token spans (transformed text), in source order. */
  ids: Map<string, Loc[]>;
  /** actor id -> the declaration that last (re)defined the actor record. */
  label: Map<string, { aliasLoc: Loc | null }>;
  /** message index -> raw TXT span of a message / note. */
  messageLoc: Map<number, Loc | null>;
  noteLoc: Map<number, Loc | null>;
}

const emptyCollected = (): Collected => ({ ids: new Map(), label: new Map(), messageLoc: new Map(), noteLoc: new Map() });

interface LocDb {
  __collected: Collected;
  getMessages(): any[];
  getActors(): Map<string, any>;
  getActorKeys(): string[];
  LINETYPE: Record<string, number>;
}

const subclassCache = new WeakMap<object, new () => LocDb>();

/** Subclass of the official SequenceDB that records which records each grammar object made. */
function locDbClass(SequenceDB: any): new () => LocDb {
  const cached = subclassCache.get(SequenceDB);
  if (cached) return cached;
  class LocSequenceDB extends SequenceDB {
    declare __collected: Collected;

    // The base constructor binds `this.apply`, which resolves to this override,
    // and its recursion over arrays calls `this.apply` for each leaf.
    apply(param: any): void {
      if (Array.isArray(param)) {
        super.apply(param);
        return;
      }
      const c = (this.__collected ??= emptyCollected());
      const records = (this as any).state.records;
      const before = records.messages.length;
      const actorBefore = typeof param?.actor === 'string' ? records.actors.get(param.actor) : undefined;

      super.apply(param);

      if (param && typeof param.actor === 'string' && Array.isArray(param.idLoc)) {
        const list = c.ids.get(param.actor) ?? [];
        list.push(param.idLoc);
        c.ids.set(param.actor, list);
      }
      if (
        (param?.type === 'addParticipant' || param?.type === 'createParticipant') &&
        typeof param.actor === 'string' &&
        records.actors.get(param.actor) !== actorBefore
      ) {
        // addActor replaced the record: this declaration owns the label now.
        c.label.set(param.actor, { aliasLoc: Array.isArray(param.aliasLoc) ? param.aliasLoc : null });
      }
      for (let i = before; i < records.messages.length; i++) {
        if (param?.type === 'addMessage') c.messageLoc.set(i, param.msg?.loc ?? null);
        else if (param?.type === 'addNote') c.noteLoc.set(i, param.text?.loc ?? null);
      }
    }
  }
  const result = LocSequenceDB as unknown as new () => LocDb;
  subclassCache.set(SequenceDB, result);
  return result;
}

let locParserPromise: Promise<any> | null = null;

/** Test seams: the chunk import of the generated parser, and its cache. */
export const __locParserImport = { load: () => import('./generated/sequenceLocParser.js') };
export function __resetLocParserForTests(): void {
  locParserPromise = null;
}

function loadLocParser(): Promise<any> {
  // Separate chunk: only diagrams that are edited on the canvas pay for it.
  // A failed chunk fetch is not cached, so the next call tries again.
  locParserPromise ??= __locParserImport.load().then(
    (m) => m.parser,
    (error) => {
      locParserPromise = null;
      throw error;
    },
  );
  return locParserPromise;
}

const sameRecord = (a: any, b: any) =>
  a.type === b.type &&
  a.from === b.from &&
  a.to === b.to &&
  JSON.stringify(a.message) === JSON.stringify(b.message) &&
  a.placement === b.placement;

/** Builds the map, or null on any disagreement. Synchronous: runs inside the mermaid queue. */
export function buildSourceMap(
  code: string,
  official: { text: string; db: any },
  locParser: any,
  maxTextSize = 50000,
  onReject?: (reason: string) => void,
): SequenceSourceMap | null {
  const reject = (reason: string): null => {
    onReject?.(reason);
    return null;
  };
  const mapped: MappedText = toParserInput(code);
  if (mapped.text !== official.text) return reject('parser input differs from Mermaid');
  // render() replaces an oversized source with an error diagram.
  if (mapped.preprocessedLength > maxTextSize) return reject('source exceeds maxTextSize');
  const T = mapped.text;

  const Db = locDbClass(official.db.constructor);
  const db = new Db();
  locParser.yy = db;
  try {
    locParser.parse(T);
  } catch {
    return reject('position parser threw');
  }
  // An empty diagram applies no leaf at all.
  const collected = db.__collected ?? emptyCollected();

  // --- Safety net: our db must equal the official db. ---
  const ours = db.getMessages();
  const theirs = official.db.getMessages();
  if (ours.length !== theirs.length) return reject('message count differs');
  for (let i = 0; i < ours.length; i++) if (!sameRecord(ours[i], theirs[i])) return reject('record differs');
  const ourKeys = db.getActorKeys();
  const theirKeys: string[] = official.db.getActorKeys();
  if (ourKeys.length !== theirKeys.length || ourKeys.some((k, i) => k !== theirKeys[i])) return reject('actor list differs');
  for (const key of ourKeys) {
    if (db.getActors().get(key)?.description !== official.db.getActors().get(key)?.description) return reject('actor description differs');
  }

  const toOriginal = ([s, e]: Loc): Range => toOriginalRange(mapped, s, e);

  // --- Participants ---
  const participants = new Map<string, ParticipantLocation>();
  for (const id of ourKeys) {
    const idRanges: Range[] = [];
    for (const raw of collected.ids.get(id) ?? []) {
      const [s, e] = actorIdRange(T, raw[0], raw[1]);
      if (T.slice(s, e) !== id) return reject('id range does not hold the id');
      const range = toOriginal([s, e]);
      // An id that Mermaid rewrote (an entity code such as `#35;`) has no
      // range that holds the id itself: not editable.
      if (code.slice(range[0], range[1]) !== id) return reject('id is rewritten by Mermaid');
      idRanges.push(range);
    }
    if (idRanges.length === 0) return reject('actor has no id range');
    const description = db.getActors().get(id)?.description;
    const label = collected.label.get(id);
    let labelRanges: Range[];
    let hasAlias: boolean;
    if (label?.aliasLoc) {
      const [s, e] = aliasTextRange(T, label.aliasLoc[0], label.aliasLoc[1]);
      hasAlias = true;
      // A `@{ "alias": ... }` config can override the `as` text; its text lives
      // inside the config and has no range here.
      labelRanges = T.slice(s, e) === description ? [toOriginal([s, e])] : [];
    } else if (description === id) {
      hasAlias = false;
      labelRanges = idRanges;
    } else {
      // Label from `@{ "alias": ... }` config only.
      hasAlias = true;
      labelRanges = [];
    }
    participants.set(id, { idRanges, labelRanges, hasAlias });
  }

  // --- Messages and notes ---
  const textEntry = (raw: Loc | null | undefined, expected: string) => {
    if (!raw) return { textRange: null };
    const [s, e] = messageTextRange(T, raw[0], raw[1]);
    if (T.slice(s, e) !== expected) return undefined;
    return { textRange: toOriginal([s, e]) };
  };
  const messages = new Map<number, { textRange: Range | null }>();
  for (const [index, raw] of collected.messageLoc) {
    const entry = textEntry(raw, theirs[index].message);
    if (!entry) return reject('text range does not hold the text');
    messages.set(index, entry);
  }
  const notes = new Map<number, { textRange: Range | null }>();
  for (const [index, raw] of collected.noteLoc) {
    const entry = textEntry(raw, theirs[index].message);
    if (!entry) return reject('text range does not hold the text');
    notes.set(index, entry);
  }

  return { kind: 'sequence', code, participants, messages, notes };
}

/**
 * Source positions for the participants, messages and notes of a Mermaid
 * sequence diagram. `code` must be the exact string given to `mermaid.render`.
 * Null when the source is not a sequence diagram, does not parse, or the
 * position parser disagrees with the official one. Never throws.
 */
export async function getSourceMap(
  code: string,
  options: { onReject?: (reason: string) => void } = {},
): Promise<SequenceSourceMap | null> {
  const reject = (reason: string): null => {
    options.onReject?.(reason);
    return null;
  };
  try {
    const locParser = await loadLocParser();
    // Queued with renders: getDiagramFromText resets Mermaid's shared diagram
    // state (title, accessibility text), as parseMermaidFlowchart does.
    return await enqueueMermaid(async () => {
      const mermaid = await loadMermaid();
      let official: any;
      try {
        official = await mermaid.mermaidAPI.getDiagramFromText(code);
      } catch {
        return reject('Mermaid does not parse the source');
      }
      if (official?.type !== 'sequence') return reject('not a sequence diagram');
      const maxTextSize = mermaid.mermaidAPI.getConfig?.()?.maxTextSize ?? 50000;
      return buildSourceMap(code, official, locParser, maxTextSize, options.onReject);
    });
  } catch (error) {
    return reject(`unexpected error: ${(error as Error)?.message ?? error}`);
  }
}
