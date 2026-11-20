/**
 * Flowcharts: node labels and edge labels, drawn as HTML inside a
 * foreignObject (Mermaid 11.17.2, htmlLabels on, the app's config).
 *
 * DOM keys, measured on a real render (fixture __fixtures__/flowchart-11.17.2.svg,
 * regenerate with scripts/mermaid-seq-loc/render-svg-fixture.mjs):
 * - Node: `g.node` whose id is `<svg id>-<vertex.domId>` (`flowchart-A-0`);
 *   there is no data-id. The svg id changes on every render, so the element
 *   is found again by the node id (map: id -> domId), never kept.
 *   Label: `foreignObject span.nodeLabel > p`.
 * - Edge label: `g.edgeLabel > g.label[data-id=<edge id>]`, the db edge id
 *   and the map key. Label: `span.edgeLabel > p`. An edge without text keeps
 *   an empty 0x0 label, which is not a target.
 * - Labels are `white-space: nowrap; max-width: 200px` until they are wider,
 *   then wrap at 200px. The layer copies max-width and wraps the same way.
 *
 * The edit is planned synchronously per keystroke (planFlow*); the commit
 * runs the official-db gate (editFlow*), which is async.
 */
import type { EditResult, FlowchartSourceMap, GetFlowchartSourceMap } from '../types';
import type { FlowPlanResult } from '../edit/flowchart';
import { KIND_PROPERTY, baseProps, type BeginResult, type InlineEditAdapter, type LabelHit, type Point } from './adapter';
import { FLOWCHART_REJECTION_MESSAGES } from './copy';

/** The flowchart edit code, loaded with the flowchart parser on the first flowchart render. */
export interface FlowchartEditApi {
  getSourceMap: GetFlowchartSourceMap;
  planNodeLabel: (code: string, map: FlowchartSourceMap, nodeId: string, text: string) => FlowPlanResult;
  planEdgeLabel: (code: string, map: FlowchartSourceMap, edgeId: string, text: string) => FlowPlanResult;
  editNodeLabel: (code: string, map: FlowchartSourceMap, nodeId: string, text: string) => Promise<EditResult>;
  editEdgeLabel: (code: string, map: FlowchartSourceMap, edgeId: string, text: string) => Promise<EditResult>;
  sourceTextOf: (map: FlowchartSourceMap, kind: 'nodeLabel' | 'edgeLabel', key: string) => string | null;
}

export interface FlowchartInlineEditDeps {
  /** Loads the flowchart edit code (and with it the parser chunk) on first use. */
  load: () => Promise<FlowchartEditApi>;
}

/**
 * Previews slower than this switch to debounced renders. Measured in
 * Storybook's Chromium (docs/features/mermaid-inline-edit.md, "Flowcharts"):
 * ~10 nodes render in well under it, ~50 nodes above it.
 */
export const FLOWCHART_SLOW_RENDER_MS = 150;

export function isFlowchartSvg(svg: Element | null | undefined): svg is SVGSVGElement {
  return !!svg && /^flowchart/.test(svg.getAttribute('aria-roledescription') ?? '');
}

/** The text a label shows, `<br>` as a line break. */
export function readHtmlLabel(label: Element): string {
  let out = '';
  for (const node of Array.from(label.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) out += (node as Text).data;
    else if (node.nodeName.toLowerCase() === 'br') out += '\n';
    else if (node.nodeType === Node.ELEMENT_NODE) out += readHtmlLabel(node as Element);
  }
  return out;
}

/** The element that holds a label's text: its single <p>, else the span. */
function textElementOf(span: Element | null): HTMLElement | null {
  if (!span) return null;
  const paragraphs = Array.from(span.children).filter((c) => c.tagName.toLowerCase() === 'p');
  return (paragraphs.length === 1 ? paragraphs[0] : span) as HTMLElement;
}

// No `foreignObject` in selectors: its camelCase name does not match a type
// selector in every engine (jsdom lowercases it).
const nodeLabelOf = (g: Element) => textElementOf(g.querySelector('span.nodeLabel'));
const edgeLabelOf = (g: Element) => textElementOf(g.querySelector('span.edgeLabel'));

function nodeGroups(svg: Element): Element[] {
  return Array.from(svg.querySelectorAll('g.node'));
}

function edgeLabelGroup(svg: Element, edgeId: string): Element | null {
  return Array.from(svg.querySelectorAll('g.edgeLabel g.label[data-id]')).find((g) => g.getAttribute('data-id') === edgeId) ?? null;
}

/** The controller's class on a label under the layer (inlineEdit.css: transparent glyphs). */
const HIDDEN_CLASS = 'mie-hidden';

const escapeRe =(s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** domId -> vertex id, per map. */
const byDomId = new WeakMap<FlowchartSourceMap, Map<string, string>>();
function vertexOfDomId(map: FlowchartSourceMap, domId: string): string | undefined {
  let index = byDomId.get(map);
  if (!index) {
    index = new Map(Array.from(map.nodes, ([id, loc]) => [loc.domId, id]));
    byDomId.set(map, index);
  }
  return index.get(domId);
}

/**
 * The label element of node `nodeId` in `svg`. By the exact `<svg id>-<domId>`
 * first; when a candidate render numbered the vertex differently, by the
 * `flowchart-<id>-<n>` pattern if it is unique.
 */
export function locateNodeLabel(svg: Element, domId: string, nodeId: string): HTMLElement | null {
  const groups = nodeGroups(svg);
  const exact = groups.find((g) => g.id === `${svg.id}-${domId}`);
  if (exact) return nodeLabelOf(exact);
  const pattern = new RegExp(`^${escapeRe(svg.id)}-flowchart-${escapeRe(nodeId)}-\\d+$`);
  const matches = groups.filter((g) => pattern.test(g.id));
  return matches.length === 1 ? nodeLabelOf(matches[0]) : null;
}

export function locateEdgeLabel(svg: Element, edgeId: string): HTMLElement | null {
  const g = edgeLabelGroup(svg, edgeId);
  return g ? edgeLabelOf(g) : null;
}

/** The label under the pointer: a node (anywhere on its shape) or an edge label with text. */
export function hitFlowchartLabel(eventTarget: EventTarget | null, svg: Element): LabelHit | null {
  if (!(eventTarget instanceof Element) || !svg.contains(eventTarget)) return null;
  const edge = eventTarget.closest('g.edgeLabel');
  if (edge && svg.contains(edge)) {
    const g = edge.querySelector('g.label[data-id]');
    const id = g?.getAttribute('data-id');
    const label = g ? edgeLabelOf(g) : null;
    // An edge without text draws an empty 0x0 label: nothing to edit there.
    if (!g || !id || !label || readHtmlLabel(label).trim() === '') return null;
    return { kind: 'edgeLabel', key: id, anchor: g };
  }
  const node = eventTarget.closest('g.node');
  if (node && svg.contains(node)) {
    const prefix = `${svg.id}-`;
    if (!svg.id || !node.id.startsWith(prefix) || !nodeLabelOf(node)) return null;
    return { kind: 'nodeLabel', key: node.id.slice(prefix.length), anchor: node };
  }
  return null;
}

export function createFlowchartAdapter(deps: FlowchartInlineEditDeps, win: Window): InlineEditAdapter<FlowchartSourceMap> {
  let api: FlowchartEditApi | null = null;
  let loading: Promise<FlowchartEditApi> | null = null;
  const load = () => (loading ??= deps.load().then((loaded) => (api = loaded)));

  /** The source-map key and location of a hit, or null when the map does not know it. */
  function resolve(hit: LabelHit, map: FlowchartSourceMap) {
    if (hit.kind === 'nodeLabel') {
      const id = vertexOfDomId(map, hit.key as string);
      const loc = id === undefined ? undefined : map.nodes.get(id);
      return id !== undefined && loc ? { kind: 'nodeLabel' as const, id, readOnly: loc.readOnly, domId: loc.domId } : null;
    }
    const loc = map.edges.get(hit.key as string);
    return loc ? { kind: 'edgeLabel' as const, id: hit.key as string, readOnly: loc.readOnly, domId: '' } : null;
  }

  return {
    diagram: 'flowchart',
    messages: FLOWCHART_REJECTION_MESSAGES,
    slowRenderMs: FLOWCHART_SLOW_RENDER_MS,
    unavailableOn: 'doubleClick',
    accepts: isFlowchartSvg,
    async getSourceMap(code) {
      return (await load()).getSourceMap(code);
    },
    prepareSvg: () => undefined,
    hit: hitFlowchartLabel,

    hoverElements(svg, hit, map) {
      const target = resolve(hit, map);
      if (!target || target.readOnly) return [];
      const label = target.kind === 'nodeLabel' ? locateNodeLabel(svg, target.domId, target.id) : locateEdgeLabel(svg, target.id);
      return label ? [label] : [];
    },

    begin(hit, map, svg, code): BeginResult {
      const target = resolve(hit, map);
      if (!target || !api) return null;
      if (target.readOnly) return { unavailable: target.readOnly };
      const { kind, id, domId } = target;
      const props = { ...baseProps('flowchart'), inline_edit_kind: KIND_PROPERTY[kind] };
      const locate = (root: Element, key: string): Element[] => {
        const label = kind === 'nodeLabel' ? locateNodeLabel(root, domId, key) : locateEdgeLabel(root, key);
        return label ? [label] : [];
      };
      const label = locate(svg, id)[0];
      if (!label) return null;
      let prefill: string | null;
      try {
        prefill = api.sourceTextOf(map, kind, id);
      } catch {
        prefill = null;
      }
      if (prefill === null) return { reject: 'position_mismatch', props };
      // The picture must be exactly what the source decodes to; otherwise inert.
      if (readHtmlLabel(label) !== prefill) return null;
      const edit = api;
      const plan = kind === 'nodeLabel' ? edit.planNodeLabel : edit.planEdgeLabel;
      const write = kind === 'nodeLabel' ? edit.editNodeLabel : edit.editEdgeLabel;
      const text = prefill;
      return {
        open: {
          props,
          ariaLabel: kind === 'nodeLabel' ? 'Edit node label' : 'Edit edge label',
          multiline: true,
          prefill,
          baseKey: id,
          locate,
          evaluate(next) {
            // A node that shows its id: retyping the id must not insert `[id]`.
            if (next === text) return { ok: true, code, key: id };
            const r = plan(code, map, id, next);
            return r.ok ? { ok: true, code: r.code, key: id } : r;
          },
          commit: (next) => write(code, map, id, next),
        },
      };
    },

    anchor(elements): Point {
      const r = elements[0].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },

    place(layer, elements, host) {
      const label = elements[0] as HTMLElement;
      const cs = win.getComputedStyle(label);
      // The controller hides the label with a transparent colour: read the ink without it.
      const hidden = label.classList.contains(HIDDEN_CLASS);
      if (hidden) label.classList.remove(HIDDEN_CLASS);
      // Not `cs.color`: a computed style is a snapshot in some engines (jsdom), live in others.
      const ink = win.getComputedStyle(label).color;
      if (hidden) label.classList.add(HIDDEN_CLASS);
      const rect = label.getBoundingClientRect();
      // HTML inside a foreignObject is scaled by the SVG transform: layout box vs screen box.
      const scale = label.offsetWidth > 0 && rect.width > 0 ? rect.width / label.offsetWidth : 1;
      const fontSize = parseFloat(cs.fontSize) || 16;
      const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.5;
      const box = label.closest('div') ?? label;
      const maxWidth = parseFloat(win.getComputedStyle(box).maxWidth);
      const hostRect = host.getBoundingClientRect();
      const st = layer.style;
      st.fontFamily = cs.fontFamily;
      st.fontWeight = cs.fontWeight;
      st.fontStyle = cs.fontStyle;
      st.letterSpacing = cs.letterSpacing;
      st.color = ink;
      st.caretColor = ink;
      st.textAlign = cs.textAlign === 'start' || !cs.textAlign ? 'center' : cs.textAlign;
      st.fontSize = `${fontSize * scale}px`;
      st.lineHeight = `${lineHeight * scale}px`;
      // Mermaid's two modes: one line up to max-width, then wrapping at max-width.
      st.whiteSpace = 'break-spaces';
      st.maxWidth = Number.isFinite(maxWidth) && maxWidth > 0 ? `${maxWidth * scale}px` : '';
      st.left = `${rect.left + rect.width / 2 - hostRect.left}px`;
      st.top = `${rect.top - hostRect.top}px`;
      st.transform = 'translateX(-50%)';
    },
  };
}
