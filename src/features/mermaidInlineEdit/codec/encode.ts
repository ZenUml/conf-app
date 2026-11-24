import { isValidActorId, isValidLineText } from '../edit/validate';
import { analyseSourceText } from './decode';
import {
  KATEX,
  WRAP_DIRECTIVE,
  hashStatementHazard,
  lineBreak,
  markerHazard,
  numericEntity,
} from './mermaidText';

/**
 * Where the encoded text will be written:
 * - `messageText`: after `:` of a message (entities and `<br>` are available);
 * - `aliasText`: after `as` of a participant declaration (same rules);
 * - `actorId`: the participant id itself, when it has no alias. Entities and
 *   line breaks do not exist there: an id is written verbatim and has to pass
 *   `isValidActorId`.
 */
export type EncodeTarget = 'messageText' | 'aliasText' | 'actorId';

export type EncodeResult = { ok: true; source: string } | { ok: false; reason: 'invalid_characters' | 'empty' };

export interface EncodeOptions {
  /** The source slice being replaced. Its `<br>` spelling is reused when it is consistent. */
  original?: string;
  /**
   * What stands before the text on its source line (for example `A->>B: `).
   * Mermaid's `style...:#...;` rewrite looks at the whole line, so an actor
   * named `mystyle` can make a `#35;` entity unsafe. Optional.
   */
  lineBefore?: string;
  /** Message text may be empty (`A->>B:`). Alias text may not. Default false. */
  allowEmpty?: boolean;
}

const fail = (reason: 'invalid_characters' | 'empty'): EncodeResult => ({ ok: false, reason });

const DEFAULT_BREAK = '<br/>';

/** The break token of `original` when every break in it is spelled the same way. */
function breakTokenOf(original: string | undefined): string {
  if (!original) return DEFAULT_BREAK;
  const tokens = original.match(lineBreak('gi'));
  if (!tokens || tokens.length === 0) return DEFAULT_BREAK;
  return tokens.every((t) => t === tokens[0]) ? tokens[0] : DEFAULT_BREAK;
}

/** Characters no encoding exists for: controls, lone surrogates, noncharacters. */
function unencodable(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if (cp === 9 || cp === 10) return false;
  if (cp < 0x20 || (cp >= 0x7f && cp <= 0x9f)) return true;
  if (cp >= 0xd800 && cp <= 0xdfff) return true;
  if (cp >= 0xfdd0 && cp <= 0xfdef) return true;
  return (cp & 0xfffe) === 0xfffe;
}

function encodeActorId(display: string): EncodeResult {
  if (display.trim() === '') return fail('empty');
  if (!isValidActorId(display) || KATEX.test(display) || markerHazard(display)) return fail('invalid_characters');
  return { ok: true, source: display };
}

/**
 * The source text for what the user typed. `\n` becomes a line break token;
 * `#` and `;` become entities; so does every other character that would
 * change meaning in place: a `<` that would start a line break or a tag
 * rewrite, `$` in `$$..$$`, a leading `%%` or `%%{`, a leading `wrap:`
 * directive, whitespace at the edges (Mermaid trims it), U+2028/2029 and
 * the marker characters Mermaid uses internally. All entities are numeric
 * (`#35;`), so the output is also valid XML after rendering.
 *
 * The result is checked: it passes `edit/validate`, and decoding it gives
 * back exactly `display` (CRLF counted as `\n`). If any check fails the text
 * is rejected rather than approximated.
 */
export function encodeDisplayText(display: string, target: EncodeTarget, opts: EncodeOptions = {}): EncodeResult {
  const text = display.replace(/\r\n?/g, '\n');
  if (target === 'actorId') {
    if (text.includes('\n')) return fail('invalid_characters');
    return encodeActorId(text);
  }

  if (text.trim() === '' && !text.includes('\n')) return opts.allowEmpty ? { ok: true, source: '' } : fail('empty');
  for (const ch of text) if (unencodable(ch)) return fail('invalid_characters');

  // `<` becomes an entity everywhere when a tag attribute could be rewritten
  // (`="x"` anywhere makes cleanupText look at every `<..>` span).
  const everyLt = text.includes('="');
  const lines = text.split('\n').map((line) => {
    let out = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '#' || ch === ';' || ch === '\u2028' || ch === '\u2029') out += numericEntity(ch);
      else if (ch === '<') {
        const at = lineBreak('iy');
        at.lastIndex = i;
        out += everyLt || at.test(line) ? numericEntity(ch) : ch;
      } else if (ch === '\uFB02' && line[i + 1] === '\u00B0') out += numericEntity(ch);
      else if (ch === '\u00B6' && line[i + 1] === '\u00DF') out += numericEntity(ch);
      else out += ch;
    }
    return out;
  });

  // Mermaid trims the whole text before it reads it: keep edge whitespace as entities.
  lines[0] = lines[0].replace(/^\s+/u, (ws) => Array.from(ws).map(numericEntity).join(''));
  const last = lines.length - 1;
  lines[last] = lines[last].replace(/\s+$/u, (ws) => Array.from(ws).map(numericEntity).join(''));

  let source = lines.join(breakTokenOf(opts.original));

  // `$$..$$` is KaTeX; `$` as an entity is plain text.
  if (KATEX.test(source)) source = source.replace(/\$/g, numericEntity('$'));
  // A leading `%%` is a comment and `%%{` anywhere is a directive: entity for the first `%`.
  if (source.startsWith('%%')) source = numericEntity('%') + source.slice(1);
  source = source.replace(/%%\{/g, `${numericEntity('%')}%{`);
  // A leading `wrap:` / `nowrap:` / `:wrap:` is consumed as a directive: entity for its first character.
  if (WRAP_DIRECTIVE.test(source)) source = numericEntity(source[0]) + source.slice(1);

  if (hashStatementHazard((opts.lineBefore ?? '') + source)) return fail('invalid_characters');
  if (!isValidLineText(source)) return fail('invalid_characters');
  const back = analyseSourceText(source, target === 'messageText' ? 'messageText' : 'participantLabel');
  if (!back.ok || back.text !== text) return fail('invalid_characters');
  return { ok: true, source };
}
