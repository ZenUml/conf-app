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

/**
 * The single seam to the parser. Today: upstream sequenceDiagram.jison plus a
 * position patch. If upstream moves sequence diagrams to Langium, replace the
 * implementation behind this signature only.
 *
 * Returns null when the source is not a sequence diagram, does not parse, or
 * the position parser disagrees with the official db (record count or order).
 * Null means: this diagram is read-only on the canvas.
 */
export type GetSourceMap = (code: string) => Promise<SequenceSourceMap | null>;

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
export type EditableKind = 'participantLabel' | 'messageText';

export const EDITABLE_KINDS: Record<string, readonly EditableKind[]> = {
  sequence: ['participantLabel', 'messageText'],
};
