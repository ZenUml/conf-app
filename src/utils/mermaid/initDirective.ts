/**
 * Detect a `%%{init: …}%%` directive that mermaid will silently discard.
 *
 * Mermaid does not report a malformed init directive. `mermaid.parse()` returns
 * success, the diagram renders with default settings, and `macro_viewed` records
 * a successful render — so nothing in the product tells the author their
 * configuration was dropped. A customer lost the `80` from `"nodeSpacing": 80`,
 * which invalidated the whole directive, reverted `useMaxWidth` to its default
 * and shrank the diagram to unreadable size with no warning anywhere.
 *
 * Measured against the real mermaid runtime (2026-09-07,
 * `vendor/mermaid/mermaid.esm.min.mjs`), `mermaid.parse` returns OK for all four
 * shapes below, but only the first one takes effect:
 *
 * | directive                        | applied? |
 * |----------------------------------|----------|
 * | `{'theme': 'forest'}`            | yes      |
 * | `{theme: "forest"}`              | no       |
 * | `{"theme": "forest",}`           | no       |
 * | `{"nodeSpacing": , …}`           | no       |
 *
 * So the test is: strict JSON, or JSON once single quotes are read as double
 * ones. That accepts mermaid's documented single-quoted form and rejects exactly
 * the three shapes it drops. When in doubt this stays silent — a false warning on
 * a working diagram is worse than missing one.
 */

export interface IgnoredInitDirective {
  /** 1-based line the directive starts on. */
  line: number;
  /** Character offset of `%%{` in the document. */
  from: number;
  /** Character offset just past the closing `}%%`. */
  to: number;
  /** The directive's object text, for quoting back to the author. */
  raw: string;
}

const DIRECTIVE = /%%\{\s*(?:init|initialize)\s*:\s*([\s\S]*?)\}%%/g;

export function findIgnoredInitDirective(code: string): IgnoredInitDirective | null {
  if (!code) return null;

  DIRECTIVE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = DIRECTIVE.exec(code)) !== null) {
    const raw = match[1].trim();
    if (isReadableByMermaid(raw)) continue;

    return {
      line: code.slice(0, match.index).split('\n').length,
      from: match.index,
      to: match.index + match[0].length,
      raw,
    };
  }

  return null;
}

function isReadableByMermaid(raw: string): boolean {
  return parses(raw) || parses(raw.replace(/'/g, '"'));
}

function parses(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}
