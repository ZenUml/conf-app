/**
 * Facts about how Mermaid 11.17.2 turns a source slice (message text, alias
 * text, actor id) into the text it draws. Every regex is copied verbatim from
 * the installed bundle; the tests render real diagrams to keep them honest.
 *
 * Pipeline for text in a sequence diagram (render path):
 * 1. `preprocessDiagram` -> `cleanupText` (mermaid.core.mjs): rewrites `="x"`
 *    to `='x'` inside anything that looks like an HTML tag (HTML_TAG).
 *    Then `removeDirectives` drops every `%%{ ... }%%` (DIRECTIVE).
 * 2. `Diagram.fromText` -> `encodeEntities` (chunks/mermaid.core/chunk-75Z2AOVW.mjs):
 *    first drops the last char (the `;`) of STYLE_HASH / CLASSDEF_HASH
 *    matches, then turns every `#\w+;` into `ﬂ°°<digits>¶ß` (all digits,
 *    no sign) or `ﬂ°<name>¶ß` (anything else).
 * 3. The sequence parser (`parseMessage`, `extractWrap`) trims the text and
 *    strips one leading `wrap:` / `nowrap:` / `:wrap:` directive.
 * 4. `drawText` (sequenceDiagram-*.mjs) splits the text on `lineBreakRegex`
 *    and draws each line with `textElem.text(line || ZWSP)`. Text goes in as
 *    text nodes, so `<`, `>` and `&` are drawn literally. KaTeX (`$$..$$`)
 *    takes another path (`hasKatex`).
 * 5. `cleanUpSvgCode` (mermaid.core.mjs) runs `decodeEntities` on the final
 *    SVG string: `ﬂ°°` -> `&#`, `ﬂ°` -> `&`, `¶ß` -> `;`. The HTML parser then
 *    reads `&#35;` / `&quot;` as the character they name.
 */

/** chunk-DU6HZSFF.mjs `lineBreakRegex` (global flag dropped: callers must not share lastIndex). */
export const LINE_BREAK_SOURCE = '<br\\s*\\/?>';
export const lineBreak = (flags = 'i') => new RegExp(LINE_BREAK_SOURCE, flags);

/** chunk-DU6HZSFF.mjs `katexRegex`. */
export const KATEX = /\$\$(.*?)\$\$/;

/** cleanupText: `="x"` inside a tag-like span is rewritten. Same regexes as sourcemap/preprocess.ts. */
export const HTML_TAG = /<(\w+)([^>]*)>/g;
export const ATTRIBUTE_QUOTES = /="([^"]*)"/g;

/** removeDirectives: any `%%{` starts a directive that Mermaid deletes. */
export const DIRECTIVE_START = /%%\{/;

/** encodeEntities: these two drop the `;` that ends an entity. */
export const STYLE_HASH = /style.*:\S*#.*;/;
export const CLASSDEF_HASH = /classDef.*:\S*#.*;/;

/** encodeEntities: the entity syntax. */
export const ENTITY = /#\w+;/g;

/**
 * `extractWrap`: a leading directive that parseMessage consumes. Mermaid's own
 * check is case-sensitive; `edit/validate.ts` rejects it case-insensitively,
 * so the codec encodes both (`Wrap: x` costs one entity, nothing else).
 */
export const WRAP_DIRECTIVE = /^:?(?:no)?wrap:/i;

/** encodeEntities replaces entities by markers made of these characters; decodeEntities maps them back. */
export const MARKER_FL = 'ﬂ';
export const MARKER_PARA = '¶';
export const ZWSP = '​';

/** True when the tag-attribute rewrite of cleanupText would change `text`. */
export function tagRewriteChanges(text: string): boolean {
  return text.replace(HTML_TAG, (_m, tag, attrs: string) => '<' + tag + attrs.replace(ATTRIBUTE_QUOTES, "='$1'") + '>') !== text;
}

/** True when encodeEntities would corrupt an entity inside `lineText` (a whole source line). */
export function hashStatementHazard(lineText: string): boolean {
  return STYLE_HASH.test(lineText) || CLASSDEF_HASH.test(lineText);
}

/** True when `text` contains a marker pair that decodeEntities would turn into something else. */
export function markerHazard(text: string): boolean {
  return text.includes(MARKER_FL + '°') || text.includes(MARKER_PARA + 'ß');
}

/**
 * Named entities the codec reproduces. Each one is verified against a real
 * render in the tests (the HTML parser decodes them; names outside this table
 * are not reproduced, so the caller treats such text as read-only).
 */
export const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  quot: '"',
  amp: '&',
  lt: '<',
  gt: '>',
  apos: "'",
  nbsp: ' ',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  bull: '•',
  laquo: '«',
  raquo: '»',
};

/**
 * Code points that `&#N;` draws as exactly that character. Excluded, with the
 * reason: C0 controls except tab (CR and LF are not kept as text, NUL becomes
 * U+FFFD), 0x7F-0x9F (the HTML parser remaps 0x80-0x9F through windows-1252),
 * surrogates and values above U+10FFFF (U+FFFD), noncharacters.
 */
export function isPlainCodePoint(cp: number): boolean {
  if (cp === 9) return true;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return false;
  if (cp >= 0xd800 && cp <= 0xdfff) return false;
  if (cp > 0x10ffff) return false;
  if (cp >= 0xfdd0 && cp <= 0xfdef) return false;
  if ((cp & 0xfffe) === 0xfffe) return false;
  return true;
}

/** `#N;` for a single character (numeric, so it is also valid XML). */
export const numericEntity = (ch: string): string => `#${ch.codePointAt(0)};`;
