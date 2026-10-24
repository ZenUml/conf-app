// Pasted-whitespace normalisation for Mermaid source.
//
// Copying a diagram out of anything rich-text (a blog post, Confluence itself,
// a chat answer rendered as HTML) turns indentation into U+00A0 NON-BREAKING
// SPACE, because that is what `&nbsp;` becomes on the clipboard. Our Mermaid
// editor has no paste filter — unlike PlantUML's — so the character is stored
// byte-exact and every later render fails.
//
// The failure is grammar-dependent, which is why it went unnoticed: mermaid's
// newer Langium grammars (pie, gitGraph, radar-beta, architecture-beta,
// packet-beta) reject U+00A0 with
//   "Parsing failed: unexpected character: -> <- at offset: N"
// while the older Jison ones (flowchart, sequenceDiagram, classDiagram,
// stateDiagram-v2, erDiagram, journey, mindmap, timeline, quadrantChart,
// xychart-beta, block-beta) accept it. Measured against mermaid 11.12.2 on
// 2026-09-08, after four production macros on one tenant rendered blank on
// every single view for three weeks.
//
// Scope is deliberately one character. U+200B (zero-width space) and U+00AD
// (soft hyphen) also break the lexer, but they are zero-width: replacing them
// with a space would insert visible whitespace the author never typed, and
// deleting them silently is a different decision with a different blast
// radius. Neither has shown up in production content, so neither is handled
// here — add them with their own evidence when they do.
const NBSP = /\u00A0/g;

export function normalizeMermaidWhitespace<T extends string | undefined | null>(code: T): T {
  if (typeof code !== 'string') return code;
  return code.replace(NBSP, ' ') as T;
}
