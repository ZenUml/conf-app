import {
  DIRECTIVE_START,
  ENTITY,
  KATEX,
  NAMED_ENTITIES,
  hashStatementHazard,
  isPlainCodePoint,
  lineBreak,
  markerHazard,
  tagRewriteChanges,
} from './mermaidText';

/** Which source slice is decoded. Both draw their lines the same way, so the rules are shared. */
export type DecodeKind = 'messageText' | 'participantLabel';

export type DecodeFailure =
  | 'multiline'
  | 'marker_chars'
  | 'directive'
  | 'katex'
  | 'tag_attribute_rewrite'
  | 'hash_statement'
  | 'raw_hash_or_semicolon'
  | 'unsupported_entity';

export type DecodeResult = { ok: true; text: string } | { ok: false; reason: DecodeFailure };

const fail = (reason: DecodeFailure): DecodeResult => ({ ok: false, reason });

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
 * Decodes a source slice like Mermaid's drawing does, with the reason when it
 * cannot. The result keeps `\n` for every line break token.
 */
export function analyseSourceText(source: string, _kind: DecodeKind = 'messageText'): DecodeResult {
  // parseMessage trims before it reads the text.
  const text = source.trim();
  if (/[\n\r]/.test(text)) return fail('multiline');
  if (markerHazard(text)) return fail('marker_chars');
  if (DIRECTIVE_START.test(text)) return fail('directive');
  if (KATEX.test(text)) return fail('katex');
  if (tagRewriteChanges(text)) return fail('tag_attribute_rewrite');
  if (hashStatementHazard(text)) return fail('hash_statement');

  // Lines are split on the raw source: an entity such as `#60;br#62;` must stay literal text.
  const lines = text.split(lineBreak('gi'));
  const decoded: string[] = [];
  for (const line of lines) {
    let bad: DecodeFailure | null = null;
    const out = line.replace(ENTITY, (entity) => {
      const ch = entityChar(entity);
      if (ch === null) bad = 'unsupported_entity';
      return ch ?? '';
    });
    if (bad) return fail(bad);
    // What is left must have no `#` or `;`: Mermaid would read it as a comment or statement end.
    if (/[#;]/.test(line.replace(ENTITY, ''))) return fail('raw_hash_or_semicolon');
    decoded.push(out);
  }
  return { ok: true, text: decoded.join('\n') };
}

/**
 * The text the user sees for a source slice: `<br>` variants become `\n`,
 * entities become the character they draw as. Null when the source uses
 * something whose drawn text cannot be reproduced exactly (see `analyseSourceText`).
 */
export function decodeSourceText(source: string, kind: DecodeKind = 'messageText'): string | null {
  const result = analyseSourceText(source, kind);
  return result.ok ? result.text : null;
}
