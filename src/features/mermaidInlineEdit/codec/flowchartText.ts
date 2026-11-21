/**
 * Facts about how Mermaid 11.17.2 turns a flowchart label slice (node text,
 * edge text) into the text it stores and draws, and the reverse: the source to
 * write for a text the user typed. Shared by sourcemap/ (parity), edit/ (the
 * encoder) and the UI (prefill).
 *
 * Pipeline for a label on the render path:
 * 1. `preprocessDiagram` -> `cleanupText`: CRLF to LF, `="x"` to `='x'` inside
 *    tag-like spans; `removeDirectives` drops every `%%{ ... }%%`;
 *    `cleanupComments` drops lines that start with `%%`.
 * 2. `Diagram.fromText` -> `encodeEntities`: `#\w+;` becomes a marker
 *    (`ﬂ°°<digits>¶ß` / `ﬂ°<name>¶ß`); a line matching `style.*:\S*#.*;` or
 *    `classDef.*:\S*#.*;` loses its last `;` first.
 * 3. The flowchart parser wrapper (flowParser.ts): `src.replace(/}\s*\n/g, '}\n')`.
 * 4. The jison lexer/parser hands the label tokens to `FlowDB.addVertex` /
 *    `addSingleLink`: `sanitizeText(text.trim())` (DOMPurify; `&` -> `&amp;`,
 *    `>` -> `&gt;`, `<br/>` -> `<br>`), then one pair of surrounding `"` is
 *    stripped. That is the db text.
 * 5. Drawing (htmlLabels): the db text goes in as HTML, `<br>` breaks the
 *    line, and `decodeEntities` turns the markers back into `&#N;` / `&name;`.
 */
import { ENTITY, HTML_TAG, ATTRIBUTE_QUOTES, KATEX, NAMED_ENTITIES, isPlainCodePoint, lineBreak, markerHazard, numericEntity } from './mermaidText';

/** chunk-SHT3W25Y.mjs, flowParser.ts: the wrapper's rewrite. */
const TRAILING_BRACE_SPACE = /}\s*\n/g;

/** `encodeEntities` marker for one `#name;` entity. */
const entityMarker = (entity: string): string => {
  const inner = entity.slice(1, -1);
  return (/^\+?\d+$/.test(inner) ? 'ﬂ\xB0\xB0' : 'ﬂ\xB0') + inner + '\xB6\xDF';
};

/**
 * The db text Mermaid stores for a label whose source slice is `source`
 * (steps 1 to 4 above, applied to the slice only). The line-level rewrites
 * (comments, directives, `style`/`classDef` `;` drop) are not replayed: when
 * they touch a label, this differs from the db and the caller gives up.
 * `sanitize` is the db's own `sanitizeText` (it depends on the config).
 */
export function flowDbTextOf(source: string, sanitize: (text: string) => string): string {
  const cleaned = source
    .replace(/\r\n?/g, '\n')
    .replace(HTML_TAG, (_m, tag: string, attrs: string) => '<' + tag + attrs.replace(ATTRIBUTE_QUOTES, "='$1'") + '>');
  const encoded = cleaned.replace(ENTITY, entityMarker).replace(TRAILING_BRACE_SPACE, '}\n');
  let text = sanitize(encoded.trim());
  if (text.startsWith('"') && text.endsWith('"')) text = text.substring(1, text.length - 1);
  return text;
}

/** HTML in a label other than a `<br>` line break: a tag, or an `&name;` / `&#N;` entity. */
export function hasHtml(source: string): boolean {
  if (/&#?\w+;/.test(source)) return true;
  return /</.test(source.replace(lineBreak('gi'), ''));
}

/**
 * Why a label slice is not editable in v1, judged on its source only:
 * `html` (see hasHtml), `unsupported` (a raw line break, KaTeX, marker
 * characters, or an entity the codec cannot decode). Null when editable.
 */
export function sourceReadOnlyReason(source: string): 'html' | 'unsupported' | null {
  if (hasHtml(source)) return 'html';
  if (/[\r\n]/.test(source) || KATEX.test(source) || markerHazard(source)) return 'unsupported';
  return decodeFlowText(source) === null ? 'unsupported' : null;
}

/** The character `#<name>;` is drawn as, or null when the codec cannot reproduce it. */
function entityChar(entity: string): string | null {
  const name = entity.slice(1, -1);
  if (/^\d+$/.test(name)) {
    const cp = Number(name);
    return Number.isSafeInteger(cp) && isPlainCodePoint(cp) ? String.fromCodePoint(cp) : null;
  }
  return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : null;
}

/**
 * The text the user sees for a label slice, for the text box: `<br>` variants
 * become `\n`, Mermaid entities (`#35;`, `#quot;`) the character they draw as.
 * Null when the slice uses something this codec cannot reproduce exactly
 * (HTML, a raw line break, KaTeX, an unknown entity).
 */
export function decodeFlowText(source: string): string | null {
  const text = source.trim();
  if (hasHtml(text) || /[\r\n]/.test(text) || KATEX.test(text) || markerHazard(text)) return null;
  const lines = text.split(lineBreak('gi'));
  const out: string[] = [];
  for (const line of lines) {
    let bad = false;
    out.push(
      line.replace(ENTITY, (entity) => {
        const ch = entityChar(entity);
        if (ch === null) bad = true;
        return ch ?? '';
      }),
    );
    if (bad) return null;
  }
  return out.join('\n');
}

/** Where encoded label text is written. Decides which characters force quotes. */
export type FlowTextContext =
  /** Node text inside `[..]`, `(..)`, `{..}`, `((..))`, `[[..]]`, `[(..)]`, `([..])`, `(((..)))`, `>..]`, `{{..}}`: lexer state `text`. */
  | 'text'
  /** Node text of `[/../]`, `[\..\]`, `[/..\]`, `[\../]`: lexer state `trapText`. */
  | 'trapText'
  /** Node text of `(-..-)`: lexer state `ellipseText`. */
  | 'ellipseText'
  /** Edge text between pipes, `-->|..|`: lexer state `text`. */
  | 'pipe'
  /** Edge text in the link, `-- .. -->`, `== .. ==>`, `-. .. .->`: lexer states `edgeText`, `thickEdgeText`, `dottedEdgeText`. */
  | 'inline';

/**
 * Characters that are plain text unquoted in every context (flow.jison of
 * mermaid@11.17.2, lexer rules quoted by their pattern):
 * - `text` state: `<text>[^\[\]\(\)\{\}\|\"]+` is TEXT;
 * - `trapText` state: `[^\\\[\]\(\)\{\}\/]+` plus a `/` or `\` not before `]`;
 * - `ellipseText` state: `[^\(\)\[\]\{\}]`, and `-)` ends the label;
 * - `edgeText` states: `[^-]|\-(?!\-)+`, `[^=]|\=(?!=)`, `[^\.]|\.(?!-)`;
 *   the link end `\s*[xo<]?\-\-+[-xo>]\s*` (and its `=`, `.` forms) also
 *   matches inside them;
 * - in every state (`<*>`): `"` starts a string, `` "` `` a markdown string,
 *   `(-` `([` `[[` `[(` `(((` `[/` `[\` `|` `(` `[` `{` start shapes or text,
 *   `\s*\~\~[\~]+\s*` is a link;
 * - INITIAL, but it scans from the start of the line, before any bracket:
 *   `[^\s\"]+\@(?=[^\{\"])` (LINK_ID) splits at an `@` that follows a non-space
 *   run, and `.*direction\s+(TB|BT|RL|LR|TD)[^\n]*` swallows the whole line.
 * Statement keywords (`end`, `style`, `subgraph`, `click`, ...) are rules of
 * the INITIAL state only; all states above are exclusive (`%x`), so a
 * keyword inside a label is plain text.
 */
const SAFE_EVERYWHERE = /^[\p{L}\p{N} ,.:;!?'*+_&#$^%`]*$/u;
/** Also plain in the `text` state (and pipes): `-`, `/`, `\`, `=`, `>`. */
const SAFE_TEXT_STATE = /^[\p{L}\p{N} ,.:;!?'*+_&#$^%`\-/\\=>]*$/u;
/** Also plain in `trapText`: `-`, `=`, `>`. */
const SAFE_TRAP = /^[\p{L}\p{N} ,.:;!?'*+_&#$^%`\-=>]*$/u;
/** Also plain in `ellipseText`: `/`, `\`, `=`, `>`. */
const SAFE_ELLIPSE = /^[\p{L}\p{N} ,.:;!?'*+_&#$^%`/\\=>]*$/u;

const SAFE_BY_CONTEXT: Record<FlowTextContext, RegExp> = {
  text: SAFE_TEXT_STATE,
  pipe: SAFE_TEXT_STATE,
  trapText: SAFE_TRAP,
  ellipseText: SAFE_ELLIPSE,
  inline: SAFE_EVERYWHERE,
};

export type FlowEncodeResult =
  | { ok: true; source: string; quoted: boolean }
  | { ok: false; reason: 'empty' | 'invalid_characters' };

export interface FlowEncodeOptions {
  context: FlowTextContext;
  /** The label is already quoted in the source: keep the quotes. */
  quoted: boolean;
  /** Inline edge text only: the characters just before and after the text range are whitespace. */
  spacedInline?: boolean;
}

/** Characters no encoding exists for: controls (tab and line feed are handled), lone surrogates, noncharacters. */
function unencodable(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if (cp === 9 || cp === 10) return false;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true;
  if (cp >= 0xd800 && cp <= 0xdfff) return true;
  if (cp === 0x2028 || cp === 0x2029) return true;
  if (cp >= 0xfdd0 && cp <= 0xfdef) return true;
  return (cp & 0xfffe) === 0xfffe;
}

const DIRECTION_LINE = /direction(\s+(?:TB|BT|RL|LR|TD))/g;

/**
 * The label source for what the user typed, without the quotes (the caller
 * adds them when `quoted` is true). The text is trimmed first: Mermaid trims
 * every label, quoted or not, so edge whitespace cannot be kept.
 *
 * - `\n` becomes `<br/>`;
 * - a `<` (other than a line break the user cannot type) is rejected:
 *   `invalid_characters`; so are control characters, U+2028/2029 and
 *   Mermaid's marker characters;
 * - `#` and `&` become entities (`#35;`, `#38;`) where they would start an
 *   entity (`#name;`, `&name;`, `&#N;`); `"` becomes `#quot;`; the first `%`
 *   of `%%{` (a directive anywhere) and `$` in `$$..$$` (KaTeX) become entities;
 *   the `d` of `direction TB` (and LR, RL, BT, TD) becomes `#100;`;
 * - the text is quoted when the label already is, or when it has a character
 *   outside the plain set of its context (SAFE_BY_CONTEXT), or, for inline
 *   edge text, when it is not surrounded by whitespace in the source (the link
 *   end can then absorb a trailing `x`, `o` or `<`);
 * - in the `text` state a leading `-` is quoted: after a `(` opening the lexer
 *   reads `(-` as the start of an ellipse (`<*>"(-"`);
 * - in quotes a leading backtick becomes `#96;`: `` "` `` would start markdown.
 *
 * The result decodes back to the trimmed input (checked).
 */
export function encodeFlowText(display: string, opts: FlowEncodeOptions): FlowEncodeResult {
  const text = display.replace(/\r\n?/g, '\n').trim();
  if (text.replace(/\n/g, '').trim() === '') return { ok: false, reason: 'empty' };
  for (const ch of text) if (unencodable(ch)) return { ok: false, reason: 'invalid_characters' };
  if (text.includes('<') || markerHazard(text)) return { ok: false, reason: 'invalid_characters' };
  const lines = text.split('\n');

  const quoted =
    opts.quoted ||
    !lines.every((line) => SAFE_BY_CONTEXT[opts.context].test(line)) ||
    (opts.context === 'inline' && !opts.spacedInline) ||
    // `<*>"(-"` starts an ellipse at a round opening: `A(-->)` is not a round node.
    (opts.context === 'text' && text.startsWith('-'));

  let source = lines
    .map((line) =>
      line
        .replace(/#(?=\w+;)/g, numericEntity('#'))
        // After the `#` rule, so the `#` of this entity is not encoded again.
        .replace(/"/g, '#quot;')
        // Last: an `&` before any entity written above (`&#quot;`) must be one too.
        .replace(/&(?=#?\w+;)/g, numericEntity('&')),
    )
    .join('<br/>');
  source = source.replace(/%%\{/g, `${numericEntity('%')}%{`);
  if (KATEX.test(source)) source = source.replace(/\$/g, numericEntity('$'));
  source = source.replace(DIRECTION_LINE, `${numericEntity('d')}irection$1`);
  if (quoted && source.startsWith('`')) source = numericEntity('`') + source.slice(1);

  if (decodeFlowText(source) !== text) return { ok: false, reason: 'invalid_characters' };
  return { ok: true, source, quoted };
}
