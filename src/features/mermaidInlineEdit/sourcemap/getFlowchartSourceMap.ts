/**
 * Position parser for Mermaid flowcharts (`graph` / `flowchart`).
 *
 * Same method as the sequence parser (getSourceMap.ts), without matching any
 * content:
 * 1. `mermaid.parse(code)` applies the diagram's own config (front matter,
 *    `%%{init}%%`) the way `render` does; `getDiagramFromText(code)` then gives
 *    the official db and the exact text Mermaid's parser wrapper received.
 * 2. `toFlowchartParserInput(code)` rebuilds that text, and the wrapper's
 *    `}\s*\n` rewrite, with an offset map back to `code`.
 * 3. Upstream flow.jison plus `flowchart.loc.patch` (generated/flowchartLocParser.js)
 *    parses the same text into a subclass of the official `FlowDB` (reached
 *    as `diagram.db.constructor`). The subclass calls `super` for everything
 *    and only notes which grammar object set each label.
 * 4. Both dbs must agree record by record (vertex ids, text, labelType,
 *    domId, type; edge ids, ends, text, labelType; subgraphs), and every range,
 *    sliced from `code`, must reproduce the db text through Mermaid's own
 *    transformation (`flowDbTextOf`); otherwise -> null.
 */
import { loadMermaid } from '@/utils/mermaid/loadMermaid';
import { enqueueMermaid } from '@/utils/mermaid/mermaidQueue';
import { flowDbTextOf, sourceReadOnlyReason } from '../codec/flowchartText';
import type { FlowEdgeLocation, FlowNodeLocation, FlowReadOnlyReason, FlowchartSourceMap, Range } from '../types';
import { toFlowchartParserInput, toOriginalRange } from './preprocess';

type Loc = [number, number];

interface TextObject {
  text: string;
  type: string;
  loc?: Loc;
  /** Set by the patch on `-- text -->` edge text (the `edgeText` rule). */
  inline?: boolean;
}

/** Who set a vertex's label last. */
type LabelOwner = { kind: 'text'; obj: TextObject } | { kind: 'shape' };

interface Collected {
  /** vertex id -> spans of its idString in `vertex` productions, in source order. */
  ids: Map<string, Loc[]>;
  label: Map<string, LabelOwner>;
  /** Ids named by `click` (setClickEvent / setLink). */
  clicked: Set<string>;
  /** One entry per edge the db kept, in db order: the link's text object. */
  edgeText: Array<TextObject | undefined>;
}

const emptyCollected = (): Collected => ({ ids: new Map(), label: new Map(), clicked: new Set(), edgeText: [] });

interface LocDb {
  __collected: Collected;
  getVertices(): Map<string, any>;
  getEdges(): any[];
  getSubGraphs(): any[];
  sanitizeText(text: string): string;
}

const subclassCache = new WeakMap<object, new () => LocDb>();

/** Subclass of the official FlowDB that records which grammar object set each label. */
function locDbClass(FlowDB: any): new () => LocDb {
  const cached = subclassCache.get(FlowDB);
  if (cached) return cached;
  class LocFlowDB extends FlowDB {
    declare __collected: Collected;

    constructor() {
      super();
      this.__collected = emptyCollected();
      // jison copies only OWN properties of `yy` into its shared state, so a
      // prototype method is invisible to the grammar: bind the hook here. The
      // base constructor already binds addVertex, addLink, setLink and
      // setClickEvent, which resolves them to the overrides below.
      (this as any).__idLoc = this.__idLoc.bind(this);
    }

    __idLoc(id: string, loc: Loc): void {
      if (typeof id !== 'string' || !Array.isArray(loc)) return;
      const list = this.__collected.ids.get(id) ?? [];
      list.push(loc);
      this.__collected.ids.set(id, list);
    }

    addVertex(id: string, textObj: TextObject | undefined, ...rest: any[]): void {
      const vertices: Map<string, any> = (this as any).vertices;
      const before = vertices.get(id);
      const snapshot = before ? { text: before.text, labelType: before.labelType } : null;
      super.addVertex(id, textObj, ...rest);
      const vertex = vertices.get(id);
      if (!vertex) return;
      if (textObj !== undefined) {
        this.__collected.label.set(id, { kind: 'text', obj: textObj });
      }
      const metadata = rest[5];
      if (metadata !== undefined) {
        // `@{ label: ... }` (and `icon:` / `img:`, which can blank the text)
        // take the label away from the bracket text. The `label:` test only
        // ever marks more labels read-only, never fewer.
        const changed = !snapshot || snapshot.text !== vertex.text || snapshot.labelType !== vertex.labelType;
        if (changed || /\blabel\s*:/.test(String(metadata))) this.__collected.label.set(id, { kind: 'shape' });
      }
    }

    addSingleLink(start: string, end: string, linkData: any, id: string | undefined): void {
      const edges: any[] = (this as any).edges;
      const count = edges.length;
      super.addSingleLink(start, end, linkData, id);
      if (edges.length > count) this.__collected.edgeText.push(linkData?.text);
    }

    setClickEvent(ids: string, ...rest: any[]): void {
      for (const id of String(ids).split(',')) this.__collected.clicked.add(id);
      super.setClickEvent(ids, ...rest);
    }

    setLink(ids: string, ...rest: any[]): void {
      for (const id of String(ids).split(',')) this.__collected.clicked.add(id);
      super.setLink(ids, ...rest);
    }
  }
  const result = LocFlowDB as unknown as new () => LocDb;
  subclassCache.set(FlowDB, result);
  return result;
}

let locParserPromise: Promise<any> | null = null;

/** Test seams: the chunk import of the generated parser, and its cache. */
export const __flowLocParserImport = { load: () => import('./generated/flowchartLocParser.js') };
export function __resetFlowLocParserForTests(): void {
  locParserPromise = null;
}

function loadLocParser(): Promise<any> {
  // Separate chunk; a failed chunk fetch is not cached, so the next call tries again.
  locParserPromise ??= __flowLocParserImport.load().then(
    (m) => m.parser,
    (error) => {
      locParserPromise = null;
      throw error;
    },
  );
  return locParserPromise;
}

/** The official db records the safety gate of the edit functions compares. */
export interface FlowchartRecords {
  vertices: Array<{ id: string; text: string; labelType: string; domId: string; type: string | undefined }>;
  edges: Array<{ id: string; start: string; end: string; text: string; labelType: string }>;
  subgraphs: Array<{ id: string; title: string }>;
}

/** Records of the official db each map was built from. Maps built by hand have none. */
const recordsOf = new WeakMap<FlowchartSourceMap, FlowchartRecords>();
export const flowchartRecordsOf = (map: FlowchartSourceMap): FlowchartRecords | undefined => recordsOf.get(map);

function records(db: any): FlowchartRecords {
  return {
    vertices: [...db.getVertices().values()].map((v: any) => ({
      id: v.id,
      text: v.text,
      labelType: v.labelType,
      domId: v.domId,
      type: v.type,
    })),
    edges: db.getEdges().map((e: any) => ({ id: e.id, start: e.start, end: e.end, text: e.text, labelType: e.labelType })),
    subgraphs: db.getSubGraphs().map((s: any) => ({ id: s.id, title: s.title })),
  };
}

const sameRecords = (a: FlowchartRecords, b: FlowchartRecords): string | null => {
  if (a.vertices.length !== b.vertices.length) return 'vertex count differs';
  for (let i = 0; i < a.vertices.length; i++) {
    const [x, y] = [a.vertices[i], b.vertices[i]];
    if (x.id !== y.id || x.text !== y.text || x.labelType !== y.labelType || x.domId !== y.domId || x.type !== y.type) {
      return 'vertex differs';
    }
  }
  if (a.edges.length !== b.edges.length) return 'edge count differs';
  for (let i = 0; i < a.edges.length; i++) {
    const [x, y] = [a.edges[i], b.edges[i]];
    if (x.id !== y.id || x.start !== y.start || x.end !== y.end || x.text !== y.text || x.labelType !== y.labelType) {
      return 'edge differs';
    }
  }
  if (a.subgraphs.length !== b.subgraphs.length) return 'subgraph count differs';
  for (let i = 0; i < a.subgraphs.length; i++) {
    if (a.subgraphs[i].id !== b.subgraphs[i].id || a.subgraphs[i].title !== b.subgraphs[i].title) return 'subgraph differs';
  }
  return null;
};

const LEADING_WS = /^\s*/;
const TRAILING_WS = /\s*$/;

/** `String.prototype.trim` on offsets (`\s` is the same character set). */
function trimRange(text: string, [start, end]: Loc): Loc {
  const slice = text.slice(start, end);
  const lead = LEADING_WS.exec(slice)![0].length;
  if (lead === slice.length) return [end, end];
  const trail = TRAILING_WS.exec(slice)![0].length;
  return [start + lead, end - trail];
}

/** Builds the map, or null on any disagreement. Synchronous: runs inside the mermaid queue. */
export function buildFlowchartSourceMap(
  code: string,
  official: { text: string; db: any },
  locParser: any,
  maxTextSize = 50000,
  onReject?: (reason: string) => void,
): FlowchartSourceMap | null {
  const reject = (reason: string): null => {
    onReject?.(reason);
    return null;
  };
  const mapped = toFlowchartParserInput(code);
  if (mapped.official !== official.text) return reject('parser input differs from Mermaid');
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
  const c = db.__collected;

  // --- Safety net: our db must equal the official db. ---
  const theirs = records(official.db);
  const differs = sameRecords(records(db), theirs);
  if (differs) return reject(differs);
  if (c.edgeText.length !== theirs.edges.length) return reject('edge text count differs');
  if (new Set(theirs.edges.map((e) => e.id)).size !== theirs.edges.length) return reject('duplicate edge id');

  const sanitize = (text: string) => official.db.sanitizeText(text);
  const toOriginal = ([s, e]: Loc): Range => toOriginalRange(mapped, s, e);
  const subgraphIds = new Set(theirs.subgraphs.map((s) => s.id));

  /**
   * Ranges of one label text object: [label, inner], both in `code`, after
   * checking that the token span holds the text the grammar built and that
   * the original slice reproduces the db text. Undefined on a mismatch.
   */
  const labelRanges = (obj: TextObject, dbText: string): { label: Range; inner: Range; source: string } | undefined => {
    if (!Array.isArray(obj.loc)) return undefined;
    const raw = obj.loc;
    if (T.slice(raw[0], raw[1]) !== obj.text) return undefined;
    const trimmed = trimRange(T, raw);
    if (flowDbTextOf(T.slice(trimmed[0], trimmed[1]), sanitize) !== dbText) return undefined;
    const label = toOriginal(trimmed);
    const source = code.slice(label[0], label[1]);
    if (flowDbTextOf(source, sanitize) !== dbText) return undefined;
    let inner = toOriginal(raw);
    // A quoted label: STR excludes its quotes; the inner range includes them.
    if (obj.type === 'string') {
      if (code[inner[0] - 1] !== '"' || code[inner[1]] !== '"') return undefined;
      inner = [inner[0] - 1, inner[1] + 1];
    }
    return { label, inner, source };
  };

  // --- Nodes ---
  const nodes = new Map<string, FlowNodeLocation>();
  for (const v of theirs.vertices) {
    const owner = c.label.get(v.id);
    const base = { domId: v.domId, shape: v.type, quoted: v.labelType === 'string' };
    let readOnly: FlowReadOnlyReason | null = null;
    let labelRange: Range | null = null;
    let innerRange: Range | null = null;
    let insertAt: number | null = null;
    if (owner?.kind === 'shape') {
      readOnly = 'shape_data';
    } else if (owner?.kind === 'text') {
      const ranges = labelRanges(owner.obj, v.text);
      if (!ranges) return reject('node label range does not reproduce the db text');
      labelRange = ranges.label;
      innerRange = ranges.inner;
      if (v.labelType === 'markdown') readOnly = 'markdown';
      else readOnly = sourceReadOnlyReason(ranges.source);
    } else {
      // No declaration carries text: the node shows its id.
      if (v.text !== v.id) return reject('node without label text does not show its id');
      const first = c.ids.get(v.id)?.[0];
      if (first && T.slice(first[0], first[1]) === v.id) {
        const r = toOriginal(first);
        if (code.slice(r[0], r[1]) === v.id) insertAt = r[1];
      }
      if (insertAt === null) readOnly = 'unsupported';
    }
    if (!readOnly && c.clicked.has(v.id)) readOnly = 'linked_node';
    if (!readOnly && subgraphIds.has(v.id)) readOnly = 'unsupported';
    nodes.set(v.id, { ...base, labelRange, innerRange, insertAt, readOnly });
  }

  // --- Edges ---
  const locUse = new Map<string, number>();
  for (const obj of c.edgeText) if (obj?.loc) locUse.set(obj.loc.join(':'), (locUse.get(obj.loc.join(':')) ?? 0) + 1);
  const edges = new Map<string, FlowEdgeLocation>();
  for (let i = 0; i < theirs.edges.length; i++) {
    const e = theirs.edges[i];
    const obj = c.edgeText[i];
    const form: 'pipe' | 'inline' = obj?.inline ? 'inline' : 'pipe';
    const quoted = e.labelType === 'string';
    if (!obj?.loc) {
      if (e.text !== '') return reject('edge text without a source range');
      edges.set(e.id, { textRange: null, innerRange: null, quoted, form, readOnly: 'no_label' });
      continue;
    }
    const ranges = labelRanges(obj, e.text);
    if (!ranges) return reject('edge label range does not reproduce the db text');
    let readOnly: FlowReadOnlyReason | null;
    if ((locUse.get(obj.loc.join(':')) ?? 0) > 1) readOnly = 'shared_edge_label';
    else if (e.text === '') readOnly = 'no_label';
    else if (e.labelType === 'markdown') readOnly = 'markdown';
    else readOnly = sourceReadOnlyReason(ranges.source);
    edges.set(e.id, { textRange: ranges.label, innerRange: ranges.inner, quoted, form, readOnly });
  }

  const map: FlowchartSourceMap = { kind: 'flowchart', code, nodes, edges };
  recordsOf.set(map, theirs);
  return map;
}

/** Diagram types the official detector gives a flowchart this map supports. */
const FLOWCHART_TYPES = new Set(['flowchart-v2', 'flowchart']);

/**
 * Source positions for the node and edge labels of a Mermaid flowchart.
 * `code` must be the exact string given to `mermaid.render`. Null when the
 * source is not a flowchart, does not parse, is laid out by ELK, turns HTML
 * labels off, or the position parser disagrees with the official one. Never throws.
 */
export async function getFlowchartSourceMap(
  code: string,
  options: { onReject?: (reason: string) => void } = {},
): Promise<FlowchartSourceMap | null> {
  const reject = (reason: string): null => {
    options.onReject?.(reason);
    return null;
  };
  try {
    const locParser = await loadLocParser();
    // Queued with renders: parse() resets Mermaid's config to the site config
    // plus this diagram's directives, exactly as render() does first.
    return await enqueueMermaid(async () => {
      const mermaid = await loadMermaid();
      let official: any;
      try {
        await mermaid.parse(code);
        official = await mermaid.mermaidAPI.getDiagramFromText(code);
      } catch {
        return reject('Mermaid does not parse the source');
      }
      if (!FLOWCHART_TYPES.has(official?.type)) return reject('not a flowchart');
      const config: any = mermaid.mermaidAPI.getConfig?.() ?? {};
      if (String(config.layout ?? '').startsWith('elk') || config.flowchart?.defaultRenderer === 'elk') {
        return reject('ELK layout');
      }
      if (config.htmlLabels === false || config.flowchart?.htmlLabels === false) return reject('htmlLabels is false');
      const maxTextSize = config.maxTextSize ?? 50000;
      return buildFlowchartSourceMap(code, official, locParser, maxTextSize, options.onReject);
    });
  } catch (error) {
    return reject(`unexpected error: ${(error as Error)?.message ?? error}`);
  }
}
