/**
 * Mirror of the text transformations Mermaid 11.17.2 applies before the
 * sequence parser sees the source, with an offset map back to the original.
 *
 * The render path is `preprocessDiagram(code)` (mermaid.core.mjs, src/preprocess.ts)
 * followed by `Diagram.fromText`, which adds `encodeEntities(text) + "\n"`.
 * `mermaidAPI.getDiagramFromText(code)` runs the same two steps, and the
 * Diagram it returns keeps the exact parser input as `.text`. The caller
 * compares `transformed.text` with that string and gives up on any
 * difference, so drift in a new Mermaid version cannot produce wrong offsets.
 *
 * Each regex below is copied verbatim; the comment names its source.
 */

/** A string derived from an original string, with two boundary maps. */
export interface MappedText {
  text: string;
  /**
   * For each boundary i (0..text.length) of `text`: the original boundary.
   * `lo` is the leftmost candidate (use it for a range end), `hi` the
   * rightmost (use it for a range start). They differ only where original
   * characters were deleted at that boundary.
   */
  lo: number[];
  hi: number[];
}

function identity(text: string): MappedText {
  const lo = Array.from({ length: text.length + 1 }, (_, i) => i);
  return { text, lo, hi: lo.slice() };
}

/**
 * `String.prototype.replace` with a global regex, keeping the boundary maps.
 * A replacement of the same length maps character by character. Otherwise the
 * common prefix and suffix of match and replacement keep their positions and
 * the differing middle collapses to its edges.
 */
export function replaceMapped(
  input: MappedText,
  regex: RegExp,
  replacer: (match: string, ...groups: string[]) => string,
): MappedText {
  if (!regex.global) throw new Error('replaceMapped needs a global regex');
  const { text, lo, hi } = input;
  const parts: string[] = [];
  const outLo: number[] = [];
  const outHi: number[] = [];

  // `bounds` has one [lo, hi] pair per boundary of the piece (length + 1).
  // The boundary shared with the previous piece keeps the previous lo (left
  // edge) and takes this piece's hi (right edge).
  const emit = (piece: string, bounds: Array<[number, number]>) => {
    let k = 0;
    if (outLo.length > 0) {
      outHi[outHi.length - 1] = bounds[0][1];
      k = 1;
    }
    for (; k < bounds.length; k++) {
      outLo.push(bounds[k][0]);
      outHi.push(bounds[k][1]);
    }
    parts.push(piece);
  };

  const emitKept = (from: number, to: number) => {
    if (from === to) return;
    const bounds: Array<[number, number]> = [];
    for (let i = from; i <= to; i++) bounds.push([lo[i], hi[i]]);
    emit(text.slice(from, to), bounds);
  };

  const emitReplacement = (a: number, b: number, match: string, r: string) => {
    const n = r.length;
    const bounds: Array<[number, number]> = [];
    if (n === match.length) {
      for (let k = 0; k <= n; k++) bounds.push([lo[a + k], hi[a + k]]);
    } else {
      let p = 0;
      while (p < n && p < match.length && r[p] === match[p]) p++;
      let q = 0;
      while (q < n - p && q < match.length - p && r[n - 1 - q] === match[match.length - 1 - q]) q++;
      for (let k = 0; k <= n; k++) {
        const fromStart = k <= p;
        const fromEnd = k >= n - q;
        const left = fromStart ? lo[a + k] : fromEnd ? lo[b - (n - k)] : lo[a + p];
        const right = fromEnd ? hi[b - (n - k)] : fromStart ? hi[a + k] : hi[b - q];
        bounds.push([left, right]);
      }
    }
    emit(r, bounds);
  };

  let cursor = 0;
  regex.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const a = m.index;
    const b = a + m[0].length;
    if (a === b) regex.lastIndex++;
    emitKept(cursor, a);
    emitReplacement(a, b, m[0], replacer(m[0], ...(m.slice(1) as string[])));
    cursor = b;
    if (regex.lastIndex > text.length) break;
  }
  emitKept(cursor, text.length);
  if (outLo.length === 0) {
    outLo.push(lo[text.length]);
    outHi.push(hi[text.length]);
  }
  const out = parts.join('');
  if (outLo.length !== out.length + 1) {
    throw new Error(`replaceMapped: ${outLo.length} boundaries for ${out.length} characters`);
  }
  return { text: out, lo: outLo, hi: outHi };
}

function sliceMapped(input: MappedText, from: number): MappedText {
  return { text: input.text.slice(from), lo: input.lo.slice(from), hi: input.hi.slice(from) };
}

function appendMapped(input: MappedText, suffix: string): MappedText {
  const end = input.text.length;
  const lo = input.lo.slice();
  const hi = input.hi.slice();
  for (let k = 0; k < suffix.length; k++) {
    lo.push(input.lo[end]);
    hi.push(input.hi[end]);
  }
  return { text: input.text + suffix, lo, hi };
}

// mermaid.core.mjs, src/preprocess.ts `cleanupText`.
const CRLF = /\r\n?/g;
const HTML_TAG = /<(\w+)([^>]*)>/g;
// chunks/mermaid.core/chunk-DU6HZSFF.mjs, src/diagram-api/regexes.ts.
const frontMatterRegex = /^([^\S\n\r]*)-{3}\s*[\n\r](.*?)[\n\r]\1-{3}\s*[\n\r]+/s;
const directiveRegex = /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;
// mermaid.core.mjs, src/diagram-api/comments.ts `cleanupComments`.
const COMMENT_LINE = /^\s*%%(?!{)[^\n]+\n?/gm;
// chunks/mermaid.core/chunk-75Z2AOVW.mjs, `encodeEntities`.
const STYLE_HASH = /style.*:\S*#.*;/g;
const CLASSDEF_HASH = /classDef.*:\S*#.*;/g;
const ENTITY = /#\w+;/g;

/** Same output as Mermaid's `preprocessDiagram(code).code`. */
function preprocessDiagram(input: MappedText): MappedText {
  // cleanupText
  let t = replaceMapped(input, CRLF, () => '\n');
  t = replaceMapped(
    t,
    HTML_TAG,
    (_match, tag, attributes) => '<' + tag + attributes.replace(/="([^"]*)"/g, "='$1'") + '>',
  );
  // processFrontmatter -> extractFrontMatter: `text.slice(matches[0].length)`.
  const fm = t.text.match(frontMatterRegex);
  if (fm) t = sliceMapped(t, fm[0].length);
  // processDirectives -> removeDirectives
  t = replaceMapped(t, directiveRegex, () => '');
  // cleanupComments, including its trimStart()
  t = replaceMapped(t, COMMENT_LINE, () => '');
  const leading = t.text.length - t.text.trimStart().length;
  if (leading > 0) t = sliceMapped(t, leading);
  return t;
}

/** Same output as Mermaid's `encodeEntities(text) + "\n"` in `Diagram.fromText`. */
function encodeEntities(input: MappedText): MappedText {
  let t = replaceMapped(input, STYLE_HASH, (s) => s.substring(0, s.length - 1));
  t = replaceMapped(t, CLASSDEF_HASH, (s) => s.substring(0, s.length - 1));
  t = replaceMapped(t, ENTITY, (s) => {
    const innerTxt = s.substring(1, s.length - 1);
    const isInt = /^\+?\d+$/.test(innerTxt);
    return isInt ? 'ﬂ\xB0\xB0' + innerTxt + '\xB6\xDF' : 'ﬂ\xB0' + innerTxt + '\xB6\xDF';
  });
  return appendMapped(t, '\n');
}

export interface ParserInput extends MappedText {
  /** Length of `preprocessDiagram(code).code`, which render() checks against `maxTextSize`. */
  preprocessedLength: number;
}

/** The string the sequence parser sees for `code` on the render path, with offset maps. */
export function toParserInput(code: string): ParserInput {
  const preprocessed = preprocessDiagram(identity(code));
  return { ...encodeEntities(preprocessed), preprocessedLength: preprocessed.text.length };
}

// chunks/mermaid.core/chunk-SHT3W25Y.mjs (src/diagrams/flowchart/parser/flowParser.ts):
// the flowchart parser wrapper runs this on the text before jison sees it.
const FLOW_TRAILING_BRACE_SPACE = /}\s*\n/g;

/**
 * The string the flowchart jison parser sees for `code` on the render path:
 * `toParserInput(code)` (what `Diagram.fromText` hands the parser wrapper),
 * then the wrapper's `src.replace(/}\s*\n/g, '}\n')`. `official` is the text
 * before the wrapper, for the comparison with `diagram.text`.
 */
export function toFlowchartParserInput(code: string): ParserInput & { official: string } {
  const before = toParserInput(code);
  const after = replaceMapped(before, FLOW_TRAILING_BRACE_SPACE, () => '}\n');
  return { ...after, preprocessedLength: before.preprocessedLength, official: before.text };
}

/** Original range for a range of the transformed text. An empty range maps to the insertion point. */
export function toOriginalRange(mapped: MappedText, start: number, end: number): [number, number] {
  if (start === end) {
    const at = mapped.lo[start];
    return [at, at];
  }
  return [mapped.hi[start], mapped.lo[end]];
}
