/**
 * Pick the diagram block plantuml.com would draw (ADR-0010).
 *
 * Production holds sources with more than one `@start…` line, such as
 *
 *   @startuml            @startuml           @startuml
 *   @startuml            @startgantt         Alice -> Bob
 *   Alice -> Bob         [Design] lasts 5d   @startjson
 *   @enduml              @endgantt           {"a": 1}
 *                        @enduml             @endjson
 *                                            @enduml
 *
 * (the paste bug fixed in conf-app#632 produced the doubled markers). The
 * in-browser engine reads the inner `@start…` as a syntax error. Measured on
 * the production corpus: 547 of 4,075 diagrams (13%) failed this way, every one
 * pointing at an inner `@start…` line, and 571 sources have such a shape.
 *
 * plantuml.com draws them. Every nested shape measured against it fits one
 * rule: a `@start…` line opens a new block and abandons anything still open,
 * and the server draws the block an `@end…` line completes. When that leaves
 * exactly one complete block, this function keeps it and turns every other line
 * into a blank line, so the line numbers in an error message still match the
 * author's source.
 *
 * Two or more complete blocks are different: the server merges them into one
 * drawing (or reports a syntax error if text sits between them), which the
 * engine cannot reproduce. Those come back with `multipleBlocks`, and engine.ts
 * hands the diagram to the server. Production had none on 2026-10-24.
 */
const START = /^\s*@start\w*\b/;
const END = /^\s*@end\w*\b/;

export function selectServerBlock(code: string): { source: string; changed: boolean; multipleBlocks: boolean } {
  const lines = code.split('\n');
  let open = -1;
  const blocks: Array<[number, number]> = [];
  let starts = 0;
  lines.forEach((line, i) => {
    if (START.test(line)) {
      open = i;
      starts += 1;
    } else if (END.test(line) && open >= 0) {
      blocks.push([open, i]);
      open = -1;
    }
  });
  if (blocks.length > 1) return { source: code, changed: false, multipleBlocks: true };
  if (starts < 2 || blocks.length === 0) return { source: code, changed: false, multipleBlocks: false };
  const [from, to] = blocks[0];
  const source = lines.map((line, i) => (i >= from && i <= to ? line : '')).join('\n');
  return { source, changed: source !== code, multipleBlocks: false };
}

/**
 * Join lines continued with a trailing backslash (ADR-0010).
 *
 * PlantUML lets a line end in `\` to continue on the next one; plantuml.com
 * joins them before parsing, the in-browser engine does not and reports a
 * syntax error. The production run left 32 syntax errors after
 * selectServerBlock, most of them at such a line. A line ending in a single
 * backslash (not `\\`) loses it and takes the next line's text; the absorbed
 * lines become blank, so error line numbers still match the author's source.
 */
const CONTINUED = /(^|[^\\])\\\r?$/;

export function joinContinuationLines(code: string): { source: string; joined: boolean } {
  if (!code.includes('\\')) return { source: code, joined: false };
  const lines = code.split('\n');
  let joined = false;
  for (let i = 0; i < lines.length - 1; i++) {
    let j = i;
    while (j < lines.length - 1 && CONTINUED.test(lines[i])) {
      j += 1;
      lines[i] = lines[i].replace(/\\\r?$/, '') + lines[j].replace(/\r$/, '');
      lines[j] = '';
      joined = true;
    }
    i = j;
  }
  return { source: joined ? lines.join('\n') : code, joined };
}
