/**
 * Label edits for Mermaid flowcharts: node labels and edge labels.
 *
 * Two layers:
 * - `planFlowNodeLabelEdit` / `planFlowEdgeLabelEdit` are pure and
 *   synchronous: they encode the text (codec/flowchartText.ts) and rewrite
 *   one range. Good enough for a preview render.
 * - `editFlowNodeLabel` / `editFlowEdgeLabel` are async: they run the plan,
 *   then `verifyFlowEdit`, which re-parses the result with the official db
 *   and accepts it only when exactly the targeted label changed. Use them for
 *   the write. They queue Mermaid work, so never await them inside
 *   `enqueueMermaid` (the queue is serial: a nested enqueue deadlocks).
 */
import { encodeFlowText, decodeFlowText, type FlowTextContext } from '../codec/flowchartText';
import { hashStatementHazard } from '../codec/mermaidText';
import {
  flowchartRecordsOf,
  getFlowchartSourceMap,
  type FlowchartRecords,
} from '../sourcemap/getFlowchartSourceMap';
import type { EditRejection, EditResult, FlowchartSourceMap, GetFlowchartSourceMap, Range } from '../types';
import { applyReplacements } from './applyReplacements';

export interface FlowEditPlan {
  ok: true;
  code: string;
  target: { kind: 'node' | 'edge'; key: string };
  /** Where the label text (inside quotes) is in `code` after the edit. */
  labelRange: Range;
  /** The label is quoted after the edit and was not before (labelType may go from `text` to `string`). */
  addedQuotes: boolean;
  /** `[text]` was inserted after a node that showed its id (its shape goes from none to `square`). */
  inserted: boolean;
}

export type FlowPlanResult = FlowEditPlan | { ok: false; reason: EditRejection };

const fail = (reason: EditRejection): { ok: false; reason: EditRejection } => ({ ok: false, reason });

function inBounds(code: string, range: Range | null): range is Range {
  if (!range) return false;
  const [start, end] = range;
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start <= end && end <= code.length;
}

/** The lexer state a node's text is read in, from its db shape (flow.jison `vertex` rule). */
function contextOfShape(shape: string | undefined): FlowTextContext {
  if (shape === 'trapezoid' || shape === 'inv_trapezoid' || shape === 'lean_right' || shape === 'lean_left') {
    return 'trapText';
  }
  if (shape === 'ellipse') return 'ellipseText';
  return 'text';
}

/** The source line around `[start, end)`. */
function lineAround(code: string, start: number, end: number): string {
  const from = code.lastIndexOf('\n', start - 1) + 1;
  const to = code.indexOf('\n', end);
  return code.slice(from, to < 0 ? code.length : to);
}

/**
 * Replaces `[start, end)` of `code` with `text`, refusing a result whose line
 * newly matches Mermaid's `style...:#...;` / `classDef...:#...;` rewrite,
 * which drops the `;` of an entity (encodeEntities).
 */
function rewrite(code: string, range: Range, text: string): { ok: true; code: string } | { ok: false; reason: EditRejection } {
  const next = applyReplacements(code, [{ range, text }]);
  const before = lineAround(code, range[0], range[1]);
  const after = lineAround(next, range[0], range[0] + text.length);
  if (hashStatementHazard(after) && !hashStatementHazard(before)) return fail('invalid_characters');
  return { ok: true, code: next };
}

/**
 * Plans a new label for node `nodeId` (db vertex id).
 * - A node with a label: its label range is replaced. When the new text
 *   needs quotes and the label had none, the whole text between the
 *   delimiters is replaced by `"..."`.
 * - A node that shows its id: `[text]` (or `["text"]`) is inserted after the
 *   first occurrence of the id. The id is never renamed.
 */
export function planFlowNodeLabelEdit(
  currentCode: string,
  map: FlowchartSourceMap,
  nodeId: string,
  newText: string,
): FlowPlanResult {
  if (currentCode !== map.code) return fail('stale_source');
  const loc = map.nodes.get(nodeId);
  if (!loc || loc.readOnly) return fail('position_mismatch');
  const target = { kind: 'node' as const, key: nodeId };

  if (loc.labelRange) {
    const label = loc.labelRange;
    const inner = loc.innerRange;
    if (!inBounds(currentCode, label) || !inBounds(currentCode, inner)) return fail('position_mismatch');
    if (inner[0] > label[0] || label[1] > inner[1]) return fail('position_mismatch');
    if (/[\r\n]/.test(currentCode.slice(inner[0], inner[1]))) return fail('position_mismatch');
    if (loc.quoted && (currentCode[inner[0]] !== '"' || currentCode[inner[1] - 1] !== '"')) return fail('position_mismatch');

    const encoded = encodeFlowText(newText, { context: contextOfShape(loc.shape), quoted: loc.quoted });
    if (!encoded.ok) return fail(encoded.reason);
    if (encoded.quoted && !loc.quoted) {
      const done = rewrite(currentCode, inner, `"${encoded.source}"`);
      if (!done.ok) return done;
      const start = inner[0] + 1;
      return { ok: true, code: done.code, target, labelRange: [start, start + encoded.source.length], addedQuotes: true, inserted: false };
    }
    const done = rewrite(currentCode, label, encoded.source);
    if (!done.ok) return done;
    return {
      ok: true,
      code: done.code,
      target,
      labelRange: [label[0], label[0] + encoded.source.length],
      addedQuotes: false,
      inserted: false,
    };
  }

  const at = loc.insertAt;
  if (at === null || !Number.isInteger(at) || at < nodeId.length || at > currentCode.length) return fail('position_mismatch');
  if (currentCode.slice(at - nodeId.length, at) !== nodeId) return fail('position_mismatch');
  // `[text]` is the `square` shape: its text is read in the lexer's `text` state.
  const encoded = encodeFlowText(newText, { context: 'text', quoted: false });
  if (!encoded.ok) return fail(encoded.reason);
  const q = encoded.quoted ? '"' : '';
  const done = rewrite(currentCode, [at, at], `[${q}${encoded.source}${q}]`);
  if (!done.ok) return done;
  const start = at + 1 + q.length;
  return {
    ok: true,
    code: done.code,
    target,
    labelRange: [start, start + encoded.source.length],
    addedQuotes: encoded.quoted,
    inserted: true,
  };
}

/**
 * Plans a new label for edge `edgeId` (db edge id). The edge form (`|t|` or
 * `-- t -->`) never changes. An edge without a label is not editable in v1,
 * and an empty text is rejected (`empty`).
 */
export function planFlowEdgeLabelEdit(
  currentCode: string,
  map: FlowchartSourceMap,
  edgeId: string,
  newText: string,
): FlowPlanResult {
  if (currentCode !== map.code) return fail('stale_source');
  const loc = map.edges.get(edgeId);
  if (!loc || loc.readOnly) return fail('position_mismatch');
  const label = loc.textRange;
  const inner = loc.innerRange;
  if (!inBounds(currentCode, label) || !inBounds(currentCode, inner)) return fail('position_mismatch');
  if (inner[0] > label[0] || label[1] > inner[1]) return fail('position_mismatch');
  if (/[\r\n]/.test(currentCode.slice(inner[0], inner[1]))) return fail('position_mismatch');
  if (loc.quoted && (currentCode[inner[0]] !== '"' || currentCode[inner[1] - 1] !== '"')) return fail('position_mismatch');
  if (loc.form === 'pipe' && (currentCode[inner[0] - 1] !== '|' || currentCode[inner[1]] !== '|')) return fail('position_mismatch');

  const spacedInline = /\s/.test(currentCode[inner[0] - 1] ?? '') && /\s/.test(currentCode[inner[1]] ?? '');
  const encoded = encodeFlowText(newText, {
    context: loc.form === 'inline' ? 'inline' : 'pipe',
    quoted: loc.quoted,
    spacedInline,
  });
  if (!encoded.ok) return fail(encoded.reason);
  const target = { kind: 'edge' as const, key: edgeId };
  if (encoded.quoted && !loc.quoted) {
    const done = rewrite(currentCode, inner, `"${encoded.source}"`);
    if (!done.ok) return done;
    const start = inner[0] + 1;
    return { ok: true, code: done.code, target, labelRange: [start, start + encoded.source.length], addedQuotes: true, inserted: false };
  }
  const done = rewrite(currentCode, label, encoded.source);
  if (!done.ok) return done;
  return { ok: true, code: done.code, target, labelRange: [label[0], label[0] + encoded.source.length], addedQuotes: false, inserted: false };
}

export interface FlowEditOptions {
  /** The source map builder the gate re-runs. Default: getFlowchartSourceMap. */
  getSourceMap?: GetFlowchartSourceMap;
}

const sameRange = (a: Range | null, b: Range) => !!a && a[0] === b[0] && a[1] === b[1];

/**
 * The safety gate. Re-runs the source map on `plan.code` and accepts the
 * edit only when, in the official db:
 * (a) the record counts and every id, edge end and subgraph are unchanged;
 * (b) the target has a label range exactly where the plan wrote the text,
 *     so its db text is Mermaid's own reading of that text (the map checks
 *     every range against the db), and it is not read-only;
 * (c) every other vertex and edge keeps its text, labelType, shape and domId.
 * The target may change only its text, and labelType `text` -> `string` when
 * the plan added quotes, and shape none -> `square` when it inserted brackets.
 * Anything else: `position_mismatch`.
 */
export async function verifyFlowEdit(
  before: FlowchartSourceMap,
  plan: FlowEditPlan,
  options: FlowEditOptions = {},
): Promise<EditResult> {
  const getMap = options.getSourceMap ?? getFlowchartSourceMap;
  const mismatch: EditResult = { ok: false, reason: 'position_mismatch' };
  const after = await getMap(plan.code);
  if (!after) return mismatch;
  let old: FlowchartRecords | undefined = flowchartRecordsOf(before);
  if (!old) {
    const rebuilt = await getMap(before.code);
    old = rebuilt ? flowchartRecordsOf(rebuilt) : undefined;
  }
  const now = flowchartRecordsOf(after);
  if (!old || !now) return mismatch;

  if (old.vertices.length !== now.vertices.length || old.edges.length !== now.edges.length) return mismatch;
  if (old.subgraphs.length !== now.subgraphs.length) return mismatch;
  for (let i = 0; i < old.subgraphs.length; i++) {
    if (old.subgraphs[i].id !== now.subgraphs[i].id || old.subgraphs[i].title !== now.subgraphs[i].title) return mismatch;
  }
  const isNode = plan.target.kind === 'node';
  for (let i = 0; i < old.vertices.length; i++) {
    const [x, y] = [old.vertices[i], now.vertices[i]];
    if (x.id !== y.id || x.domId !== y.domId) return mismatch;
    if (isNode && x.id === plan.target.key) {
      const typeOk = x.type === y.type || (plan.inserted && x.type === undefined && y.type === 'square');
      const labelTypeOk = x.labelType === y.labelType || (plan.addedQuotes && x.labelType === 'text' && y.labelType === 'string');
      if (!typeOk || !labelTypeOk) return mismatch;
      continue;
    }
    if (x.text !== y.text || x.labelType !== y.labelType || x.type !== y.type) return mismatch;
  }
  for (let i = 0; i < old.edges.length; i++) {
    const [x, y] = [old.edges[i], now.edges[i]];
    if (x.id !== y.id || x.start !== y.start || x.end !== y.end) return mismatch;
    if (!isNode && x.id === plan.target.key) {
      const labelTypeOk = x.labelType === y.labelType || (plan.addedQuotes && x.labelType === 'text' && y.labelType === 'string');
      if (!labelTypeOk) return mismatch;
      continue;
    }
    if (x.text !== y.text || x.labelType !== y.labelType) return mismatch;
  }

  const loc = isNode ? after.nodes.get(plan.target.key) : after.edges.get(plan.target.key);
  if (!loc || loc.readOnly) return mismatch;
  const range = 'labelRange' in loc ? loc.labelRange : loc.textRange;
  if (!sameRange(range, plan.labelRange)) return mismatch;
  return { ok: true, code: plan.code };
}

/** Plan + gate for a node label. Async: see the file comment. */
export async function editFlowNodeLabel(
  currentCode: string,
  map: FlowchartSourceMap,
  nodeId: string,
  newText: string,
  options: FlowEditOptions = {},
): Promise<EditResult> {
  const plan = planFlowNodeLabelEdit(currentCode, map, nodeId, newText);
  return plan.ok ? verifyFlowEdit(map, plan, options) : plan;
}

/** Plan + gate for an edge label. Async: see the file comment. */
export async function editFlowEdgeLabel(
  currentCode: string,
  map: FlowchartSourceMap,
  edgeId: string,
  newText: string,
  options: FlowEditOptions = {},
): Promise<EditResult> {
  const plan = planFlowEdgeLabelEdit(currentCode, map, edgeId, newText);
  return plan.ok ? verifyFlowEdit(map, plan, options) : plan;
}

/**
 * The text to prefill the text box with: the decoded label (`<br/>` as a
 * line break, `#quot;` as `"`), or the id for a node that shows its id.
 * Null when the target is read-only, missing, or its text cannot be decoded.
 */
export function flowSourceTextOf(map: FlowchartSourceMap, kind: 'nodeLabel' | 'edgeLabel', key: string): string | null {
  if (kind === 'nodeLabel') {
    const loc = map.nodes.get(key);
    if (!loc || loc.readOnly) return null;
    if (loc.labelRange) return inBounds(map.code, loc.labelRange) ? decodeFlowText(map.code.slice(...loc.labelRange)) : null;
    return loc.insertAt !== null ? key : null;
  }
  const loc = map.edges.get(key);
  if (!loc || loc.readOnly || !inBounds(map.code, loc.textRange)) return null;
  return decodeFlowText(map.code.slice(...loc.textRange));
}
