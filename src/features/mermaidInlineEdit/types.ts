/**
 * Contract between the position parser (sourcemap/), the pure edit functions
 * (edit/) and the interaction layer (ui/). Change it only together with all
 * three.
 */

/** Half-open [start, end) UTF-16 offsets into the exact source string that was parsed. */
export type Range = [start: number, end: number];

export interface ParticipantLocation {
  /**
   * Where the text shown on the diagram lives in the source: the alias when
   * the participant has one, otherwise the same ranges as `idRanges`.
   * A range covers the user's text without surrounding whitespace. Quotes are
   * part of the text: Mermaid 11.17.2 keeps `"Alice"` with its quotes as the
   * id or alias, so the range includes them.
   * Empty with `hasAlias: true` when the alias exists only inside an
   * `@{ "alias": ... }` config block: that label is not editable on the canvas.
   * A slice is source text, so it can differ from the rendered text (`#35;`
   * against the character it encodes).
   */
  labelRanges: Range[];
  /**
   * Every occurrence of the actor id in the source: declaration, both message
   * ends, activate/deactivate, note, create/destroy, box members, links.
   * `code.slice(...range)` equals the id for every range.
   */
  idRanges: Range[];
  hasAlias: boolean;
}

export interface SequenceSourceMap {
  /**
   * Discriminator against `FlowchartSourceMap`. Optional so that maps built
   * before flowcharts existed (and test fakes) stay valid: absent means sequence.
   */
  kind?: 'sequence';
  /**
   * The exact source this map was computed from, which must be the exact
   * string given to `mermaid.render`. Offsets are valid for this string only.
   */
  code: string;
  /** Key: actor id, which is the `data-id` of the SVG participant element. */
  participants: Map<string, ParticipantLocation>;
  /**
   * Key: index in the official db `messages` array, which is the SVG
   * `data-id` without its leading "i". `textRange` covers the message text
   * without the leading ":", an optional `wrap:` / `nowrap:` prefix, or
   * surrounding whitespace. An empty message text gives an empty range at the
   * insertion point. Records that are not messages (loop, alt, activation)
   * have no entry; the current parser never produces a null range, and
   * consumers treat null as "not editable".
   */
  messages: Map<number, { textRange: Range | null }>;
  /** Key: index in the same `messages` array (notes are records there too). */
  notes: Map<number, { textRange: Range | null }>;
}

/** Why a flowchart label stays read-only on the canvas (v1 rules). */
export type FlowReadOnlyReason =
  /** `labelType === 'markdown'`: a `` "`...`" `` label. */
  | 'markdown'
  /** The label belongs to `@{ ... }` shape data (`label:`, `icon:`, `img:`), or the node has shape data that sets one. */
  | 'shape_data'
  /** The source holds HTML other than a `<br>` line break, or an `&name;` / `&#N;` entity. */
  | 'html'
  /** One label range drives several edges (`A & B -->|t| C`). */
  | 'shared_edge_label'
  /** An edge without label text. */
  | 'no_label'
  /** The node is the target of a `click` statement. */
  | 'linked_node'
  /**
   * Anything else this version does not edit: a raw line break inside a quoted
   * label, KaTeX (`$$..$$`), a node that is also a subgraph id, a node shown by
   * its id with no `vertex` occurrence to insert brackets after (only in
   * `style` / `class` lines), an entity that cannot be decoded for the text box.
   */
  | 'unsupported';

export interface FlowNodeLocation {
  /** db `vertex.domId` (`flowchart-<id>-<n>`), which ends the id of the SVG `g.node`. */
  domId: string;
  /**
   * Range of the label text inside its brackets: quotes excluded, surrounding
   * whitespace excluded (Mermaid trims it). It is from the last declaration
   * that carries text, which is the one the db shows. Null when the node
   * shows its id (no declaration carries text) or the label comes from shape
   * data. A slice is source text (`#35;`, `<br/>`), not the drawn text.
   */
  labelRange: Range | null;
  /**
   * The whole source between the shape's delimiters of that same declaration,
   * whitespace and quotes included (`[ "t" ]` is a parse error, so a quoted
   * label has no padding). An edit that has to add quotes replaces this range.
   * Null exactly when `labelRange` is null.
   */
  innerRange: Range | null;
  /** `labelType === 'string'`: the label is written `["..."]`. */
  quoted: boolean;
  /**
   * For a node that shows its id: the offset just after the first occurrence
   * of the id in a vertex position (the `vertex` grammar rule, not `style`,
   * `class` or `click`), where `[text]` can be inserted. Null otherwise.
   */
  insertAt: number | null;
  /** db `vertex.type` (`square`, `round`, `trapezoid`, ...; undefined for a bare id). Decides the quoting rules. */
  shape: string | undefined;
  /** Set when the label must stay read-only. */
  readOnly: FlowReadOnlyReason | null;
}

export interface FlowEdgeLocation {
  /** Range of the edge text, quotes and surrounding whitespace excluded. Null for an edge without text. */
  textRange: Range | null;
  /** Between the pipes (`pipe`) or between the link start and end (`inline`), whitespace and quotes included. Null with `textRange`. */
  innerRange: Range | null;
  /** `labelType === 'string'`: the text is written in quotes. */
  quoted: boolean;
  /** `A -->|t| B` is `pipe`; `A -- t --> B`, `A == t ==> B`, `A -. t .-> B` are `inline`. An edit never changes it. */
  form: 'pipe' | 'inline';
  /** Set when the label must stay read-only. */
  readOnly: FlowReadOnlyReason | null;
}

export interface FlowchartSourceMap {
  kind: 'flowchart';
  /** The exact source this map was computed from (the string given to `mermaid.render`). */
  code: string;
  /** Key: vertex id (db key), in db order. Every vertex has an entry; subgraph titles have none. */
  nodes: Map<string, FlowNodeLocation>;
  /** Key: db edge id (the SVG `data-id` of the edge path and of its label), in db order. */
  edges: Map<string, FlowEdgeLocation>;
}

/** What the parser seam returns: a sequence map or a flowchart map. */
export type SourceMap = SequenceSourceMap | FlowchartSourceMap;

/**
 * The single seam to the parsers. Today: upstream sequenceDiagram.jison and
 * flow.jison, each with a position patch. If upstream moves a diagram type to
 * Langium, replace the implementation behind this signature only.
 *
 * Returns null when the source is not a supported diagram, does not parse, or
 * the position parser disagrees with the official db (record count or order,
 * texts, ids). Null means: this diagram is read-only on the canvas.
 */
export type GetSourceMap = (code: string) => Promise<SourceMap | null>;

/** The sequence-only seam the shipped sequence UI uses (`sourcemap/getSourceMap.ts`). */
export type GetSequenceSourceMap = (code: string) => Promise<SequenceSourceMap | null>;

/** The flowchart-only seam (`sourcemap/getFlowchartSourceMap.ts`). */
export type GetFlowchartSourceMap = (code: string) => Promise<FlowchartSourceMap | null>;

export type EditRejection =
  /** The source changed after the map was computed. */
  | 'stale_source'
  /** The new participant name is already used by another participant. */
  | 'name_exists'
  /** The new text has a character that would break the syntax (newline, `#`, `;`, ...). */
  | 'invalid_characters'
  /** The new text is empty where the syntax needs a value. */
  | 'empty'
  /** The map has no range for the target, or the range does not hold the expected text. */
  | 'position_mismatch';

export type EditResult = { ok: true; code: string } | { ok: false; reason: EditRejection };

/** Element kinds a diagram type lets the user edit on the canvas. */
export type EditableKind = 'participantLabel' | 'messageText' | 'nodeLabel' | 'edgeLabel';

export const EDITABLE_KINDS: Record<string, readonly EditableKind[]> = {
  sequence: ['participantLabel', 'messageText'],
  flowchart: ['nodeLabel', 'edgeLabel'],
};
