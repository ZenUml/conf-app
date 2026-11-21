/**
 * What the in-place editor (controller.ts) needs to know about one Mermaid
 * diagram type. The controller owns the session: the text layer, the render
 * loop, the view keeper, commit / cancel / abort, hover, hint and analytics.
 * An adapter owns everything that depends on the diagram: which rendered
 * element is which source-map key, how the layer copies the label's font and
 * position, the prefill, the live candidate and the write.
 *
 * Adapters: sequenceAdapter.ts (SVG <text> labels), flowchartAdapter.ts (HTML
 * labels in a foreignObject).
 */
import type { InlineEditDiagram, InlineEditKind, InlineEditUnavailableReason } from '@/utils/analytics/catalog';
import type { AnalyticsProperties } from '@/utils/analytics/types';
import type { EditRejection, EditResult, EditableKind, SourceMap } from '../types';

export interface Point {
  x: number;
  y: number;
}

/** The label a pointer event landed on, found from the rendered DOM alone. */
export interface LabelHit {
  kind: EditableKind;
  /** The DOM key: message index, actor id, flowchart vertex domId or edge id. */
  key: string | number;
  /** The element the pointer was on (sequence: the participant copy). */
  anchor: Element;
}

/** A candidate source for the layer's text, or why there is none. */
export type Candidate =
  | { ok: true; code: string; /** The target's element key in the render of `code`. */ key: string }
  | { ok: false; reason: EditRejection };

/** One open edit, built by `InlineEditAdapter.begin`. Holds its base code and map. */
export interface EditHandle {
  /** Analytics properties of every event about this edit: diagram, kind. Never text, ids or indexes. */
  props: AnalyticsProperties;
  ariaLabel: string;
  /** aria-multiline, and Shift+Enter inserts a line break. */
  multiline: boolean;
  /** The text the layer opens with. */
  prefill: string;
  /** The target's element key in the base render. */
  baseKey: string;
  /** The label elements of the target in `svg`, where the target has element key `key`. */
  locate(svg: Element, key: string): Element[];
  /** Synchronous, from the base. Unchanged text gives the base code. Used per keystroke. */
  evaluate(text: string): Candidate;
  /**
   * The write for a text whose `evaluate` gave `planned`. Synchronous when the
   * plan is final (sequence); a Promise when a gate has to re-parse it
   * (flowchart). The Promise must never be awaited inside `enqueueMermaid`.
   */
  commit(text: string, planned: string): EditResult | Promise<EditResult>;
}

export type BeginResult =
  | { open: EditHandle }
  /** Toast and a rejected event, no layer. */
  | { reject: EditRejection; props: AnalyticsProperties }
  /** A read-only label: nothing visible, an unavailable event (deduped). */
  | { unavailable: InlineEditUnavailableReason }
  /** Inert: nothing at all. */
  | null;

export interface InlineEditAdapter<M extends SourceMap = SourceMap> {
  readonly diagram: InlineEditDiagram;
  /** Hint and toast text per rejection. */
  readonly messages: Record<EditRejection, string>;
  /**
   * When the last preview render took longer than this (ms), preview renders
   * wait for a typing pause instead of following every coalesced frame.
   * Null: never.
   */
  readonly slowRenderMs: number | null;
  /**
   * When a diagram without a source map reports `editor_inline_edit_unavailable`:
   * after the render (sequence, shipped rule) or on a double-click on a label (flowchart).
   */
  readonly unavailableOn: 'render' | 'doubleClick';
  /** The rendered SVG is this diagram type. */
  accepts(svg: Element | null): boolean;
  /** Null: the whole diagram is read-only. A map for other code is ignored by the controller. */
  getSourceMap(code: string): Promise<M | null>;
  /** Before any lookup on a newly rendered SVG (sequence: our tags). */
  prepareSvg(svg: Element): void;
  hit(eventTarget: EventTarget | null, svg: Element): LabelHit | null;
  /** Elements outlined on hover; empty when the label is not editable. */
  hoverElements(svg: Element, hit: LabelHit, map: M): Element[];
  begin(hit: LabelHit, map: M, svg: Element, code: string): BeginResult;
  /** The screen point that stays still across re-renders. */
  anchor(elements: Element[]): Point;
  /** Copy the label's font, colour and position onto the layer (styles only, never text). */
  place(layer: HTMLDivElement, elements: Element[], host: HTMLElement): void;
}

export const KIND_PROPERTY: Record<EditableKind, InlineEditKind> = {
  participantLabel: 'participant_label',
  messageText: 'message_text',
  nodeLabel: 'node_label',
  edgeLabel: 'edge_label',
};

export const baseProps = (diagram: InlineEditDiagram): AnalyticsProperties => ({
  feature_area: 'macro', surface: 'editor', macro_type: 'mermaid', inline_edit_diagram: diagram,
});

/** Union of the elements' screen boxes. */
export function unionRect(elements: Element[]): { left: number; top: number; right: number; bottom: number } {
  const rects = elements.map((e) => e.getBoundingClientRect());
  return {
    left: Math.min(...rects.map((r) => r.left)),
    top: Math.min(...rects.map((r) => r.top)),
    right: Math.max(...rects.map((r) => r.right)),
    bottom: Math.max(...rects.map((r) => r.bottom)),
  };
}
