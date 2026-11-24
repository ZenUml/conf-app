/**
 * Character rules for text written back into Mermaid sequence source.
 *
 * Evidence: the jison lexer of mermaid 11.17.2 (sequenceDiagram.jison, tag
 * mermaid@11.17.2; installed chunk sequenceDiagram-*.mjs). Rule numbers below
 * are indexes in that lexer's `rules` array. Every rule here is also checked
 * against the official parser in validate.spec.ts.
 */

const ENTITY = /#\w+;/g; // mermaid's encodeEntities() runs before lexing

/** Removes `#35;` / `#quot;` style entities, which mermaid encodes before lexing. */
function withoutEntities(text: string): string {
  return text.replace(ENTITY, '');
}

const LINE_BREAK = /[\n\r\u2028\u2029]/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Words that start a statement in the INITIAL lexer state (rules 16-33, 35-47,
 * 55-58), each matched with a trailing `\b`, case-insensitively. An actor id
 * that starts with one of them is lexed as the keyword in a message line.
 */
const KEYWORD_PREFIX = new RegExp(
  '^(?:box|participant|actor|create|destroy|loop|rect|opt|alt|else|par|par_over|and|critical|option|break|end|' +
    'left of|right of|links|link|properties|details|over|note|activate|deactivate|' +
    'title|accTitle|accDescr|sequenceDiagram|autonumber|off)\\b',
  'i',
);

/** Rule 6: a leading number followed by a space is a NUM token (autonumber). */
const LEADING_NUMBER = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})(?:\s|$)/;

/** An ACTOR token ends at ` as ` (rule 12) or a trailing ` as` before a line end. */
const AS_KEYWORD = /(?:^|\s)as(?:\s|$)/i;

/**
 * Returns true when `name` can be written as an actor id and read back as the
 * same id in every position (declaration, either end of a message,
 * activate/deactivate, note over, create/destroy, box member).
 *
 * Rejected, with the lexer rule that makes each one unsafe:
 * - line breaks, control characters and any whitespace other than a plain space (rule 0 ends the line; rule 13 and 60
 *   cannot span lines)
 * - `; , : < > @` (rules 13/60 exclude them: `;` `,` `:` end the token, `<>`
 *   start arrows, `@` starts a `@{...}` config block)
 * - `#` (rule 3: starts a comment, and `#word;` is an entity)
 * - `+` (rule 60 excludes it; it is the activation shorthand before an actor)
 * - `%` at the start or `%%` anywhere (rules 4 and 5: comments)
 * - a first character in `/ \ ( ) -` (rule 60's first segment excludes them)
 * - `-` followed by `x ) - | \ / >` or ending the name (rule 60's lookahead
 *   stops the token at any arrow prefix such as `-x`, `-)`, `--`, `-|\`)
 * - the sequences `()`, `//-`, `\\-`, `/|-`, `\|-`, also at the end of the name
 *   where an arrow follows (the same lookahead)
 * - a leading statement keyword (`end`, `note`, `loop`, ...)
 * - a leading number followed by a space, or a name that is only a number
 * - ` as ` or a trailing ` as` (rule 12 would split off an alias)
 */
export function isValidActorId(name: string): boolean {
  if (name.length === 0) return false;
  if (name !== name.trim()) return false;
  if (LINE_BREAK.test(name) || CONTROL.test(name) || /[^\S ]/.test(name)) return false;
  if (/[;,:<>@#+]/.test(name)) return false;
  if (name[0] === '%' || name.includes('%%')) return false;
  if (/^[/\\()-]/.test(name)) return false;
  if (/-(?:[x)\-|\\/>]|$)/i.test(name)) return false;
  if (/\(\)|(?:\/\/|\\\\|\/\||\\\|)(?:-|$)/.test(name)) return false;
  if (KEYWORD_PREFIX.test(name)) return false;
  if (LEADING_NUMBER.test(name)) return false;
  if (AS_KEYWORD.test(name)) return false;
  return true;
}

/** Marks a leading `wrap:` / `nowrap:` / `:wrap:` that parseMessage() would read as a directive. */
const WRAP_DIRECTIVE = /^:?(?:no)?wrap:/i;

/**
 * Text after `:` (message) or after `as` (participant alias). Both are the
 * lexer's LINE/TXT token `[^#\n;]*` (rules 34 and 87) after pre-processing
 * has encoded `#word;` entities. Rejected: line breaks, `;`, and `#` outside
 * an entity, plus a leading wrap directive that would change the meaning.
 */
export function isValidLineText(text: string): boolean {
  if (LINE_BREAK.test(text)) return false;
  const rest = withoutEntities(text);
  if (/[;#]/.test(rest)) return false;
  if (WRAP_DIRECTIVE.test(text)) return false;
  return true;
}

/**
 * Text that starts with `%%` and sits directly after `:` or `as` would be read
 * as a comment together with that char (rule 5 `[^\}]%%[^\n]*`). A leading space
 * avoids it, and the parser trims the text, so the meaning is unchanged.
 */
export function guardLeadingText(code: string, start: number, text: string): string {
  if (text.startsWith('%%') && start > 0 && !/\s/.test(code[start - 1])) return ` ${text}`;
  return text;
}
