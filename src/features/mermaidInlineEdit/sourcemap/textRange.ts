/**
 * Narrows a raw token span to the user's text, by replaying on offsets the
 * string operations Mermaid 11.17.2 performs on the token:
 *
 * - message / note text (`text2`): `$1.trim().substring(1)`, then
 *   `SequenceDB.parseMessage` -> `str.trim()` -> `extractWrap`:
 *   `text.trim()`, strip `/^:?(?:no)?wrap:/`, `.trim()`.
 * - alias (`restOfLine`): `parseMessage($4)` only.
 * - actor id (`ACTOR`): the lexer action `yytext.trim()`.
 *
 * All offsets are into the parser input (transformed text), not the original.
 */

const LEADING_WS = /^\s*/;
const TRAILING_WS = /\s*$/;
// SequenceDB.extractWrap, the prefix it removes.
const WRAP_PREFIX = /^:?(?:no)?wrap:/;

function trim(text: string, start: number, end: number): [number, number] {
  const slice = text.slice(start, end);
  const lead = LEADING_WS.exec(slice)![0].length;
  if (lead === slice.length) return [end, end];
  const trail = TRAILING_WS.exec(slice)![0].length;
  return [start + lead, end - trail];
}

/** Range of the cleaned text, or an empty range at the insertion point when it is empty. */
function parseMessageRange(text: string, start: number, end: number): [number, number] {
  // parseMessage: str.trim(); extractWrap: text.trim()
  let [s, e] = trim(text, start, end);
  let anchor = start;
  const prefix = WRAP_PREFIX.exec(text.slice(s, e));
  if (prefix) {
    s += prefix[0].length;
    anchor = s;
  }
  [s, e] = trim(text, s, e);
  if (s >= e) return [anchor, anchor];
  return [s, e];
}

/** `TXT` token span (`":"...`) -> message or note text span. */
export function messageTextRange(text: string, start: number, end: number): [number, number] {
  const [s, e] = trim(text, start, end);
  // substring(1) drops the ':' the token always starts with.
  if (text[s] !== ':') throw new Error('TXT token does not start with ":"');
  return parseMessageRange(text, s + 1, e);
}

/** `restOfLine` token span -> alias text span. */
export function aliasTextRange(text: string, start: number, end: number): [number, number] {
  return parseMessageRange(text, start, end);
}

/** `ACTOR` token span -> actor id span. */
export function actorIdRange(text: string, start: number, end: number): [number, number] {
  return trim(text, start, end);
}
