// #373: a PlantUML source pasted into a ZenUML sequence macro parses without
// error but renders nonsense (PlantUML keywords become their own lifelines,
// alias declarations duplicate lifelines, activate/deactivate become blank
// self-messages). There is no parser error to hook into, so detection has to
// look at the raw source text before it ever reaches the ZenUML renderer.
//
// Detection is deliberately narrow: `@startuml` (optionally followed by a
// diagram name, e.g. `@startuml MyDiagram`) is PlantUML's own required fence
// opener — https://plantuml.com/sequence-diagram — and is not valid ZenUML
// syntax in any position, so it cannot fire on real ZenUML source. A false
// positive that nags a user writing valid ZenUML is worse than a missed
// detection (see issue #373 "Scope"), so no keyword-density heuristic
// (autonumber/actor/participant/activate — all of which double as ordinary
// English words a user might type in a message body) is used.
//
// Mermaid detection (2026-09-08 replay): a Mermaid `erDiagram` pasted into a
// new Sequence macro parsed as ZenUML text and the parser choked on `PK, FK`
// and `||--o{`, surfacing raw ANTLR text ("no viable alternative at input
// 'PK, FK'") with no route to the Mermaid tab. Mermaid's own opener keywords
// (erDiagram, sequenceDiagram, flowchart <DIR>, ...) are not valid ZenUML
// syntax either, but several of them (`graph`, `timeline`) are also
// plausible ZenUML lifeline/method names, so — same "false positive is worse
// than a miss" principle as PlantUML above — detection is anchored to the
// FIRST MEANINGFUL LINE of the source only (skipping blank lines, `%%`
// comments/init directives and a leading YAML front-matter block, after a
// Markdown fence and any prose around it is removed), matched
// case-sensitively, and keywords that double as identifiers (`graph`,
// `flowchart`) additionally require a direction token or, bare, an edge
// operator on the next line, so `graph.render()` and a bare `graph`
// participant line do not match.
import { stripMarkdownFence } from "@/model/Diagram/markdownFence";

export type ForeignDialect = "plantuml" | "mermaid";

const PLANTUML_FENCE = /^\s*@startuml\b/im;

// Simple Mermaid diagram openers: the keyword must be followed by whitespace,
// end of line, or end of input.
const MERMAID_SIMPLE_KEYWORDS =
  /^(erDiagram|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|gantt|pie|mindmap|gitGraph|journey|timeline|C4Context|C4Container|C4Component|C4Dynamic|C4Deployment|quadrantChart|requirementDiagram|xychart-beta|sankey-beta|block-beta|architecture-beta|packet-beta|radar-beta)(?=\s|$)/;

// `flowchart`/`graph` double as ordinary identifiers, so they need a direction
// token or, bare, an edge operator on the next meaningful line — a bare `graph`
// line or `graph.render()` alone is not enough. The direction stays upper-case:
// Mermaid's own lexer rejects `graph td` ("Lexical error on line 1"), so
// routing it to the Mermaid tab would only move the error.
const MERMAID_DIRECTIONAL_KEYWORDS = /^(flowchart|graph)\s+(TB|TD|BT|RL|LR)(?=\s|;|$)/;
const MERMAID_BARE_KEYWORDS = /^(flowchart|graph)\s*;?\s*$/;
const MERMAID_EDGE = /--[->xo]|-\.->|==>/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function isMermaidCommentOrDirective(line: string): boolean {
  return line.trim().startsWith("%%");
}

// Returns the first two meaningful lines after leading blank lines, `%%`
// comments/init directives and a leading YAML front-matter block.
function firstMeaningfulLines(code: string): [string | null, string | null] {
  const lines = code.split(/\r\n|\r|\n/);
  let i = 0;

  if (i < lines.length && lines[i].trim() === "---") {
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "---") j++;
    if (j < lines.length) {
      i = j + 1;
    }
  }

  const found: string[] = [];
  for (; i < lines.length && found.length < 2; i++) {
    if (isBlank(lines[i]) || isMermaidCommentOrDirective(lines[i])) continue;
    found.push(lines[i]);
  }
  return [found[0] ?? null, found[1] ?? null];
}

function isMermaidOpener(line: string, next: string | null): boolean {
  const trimmed = line.trimStart();
  if (MERMAID_SIMPLE_KEYWORDS.test(trimmed) || MERMAID_DIRECTIONAL_KEYWORDS.test(trimmed)) return true;
  return MERMAID_BARE_KEYWORDS.test(trimmed.trimEnd()) && next !== null && MERMAID_EDGE.test(next);
}

// The Mermaid source inside `code` (a Markdown fence and any prose around it
// removed), or null when `code` is not Mermaid. Returns `code` itself when no
// fence was involved. A fence labelled `mermaid` is trusted even when its
// opener is not in the list above.
export function extractMermaidSource(code: string | null | undefined): string | null {
  if (!code) return null;
  const stripped = stripMarkdownFence(code);
  const [line, next] = firstMeaningfulLines(stripped.text);
  const isMermaid =
    (line !== null && isMermaidOpener(line, next)) || (stripped.fenced && stripped.language === "mermaid");
  if (!isMermaid) return null;
  return stripped.fenced ? stripped.text : code;
}

export function detectForeignDialect(code: string | null | undefined): ForeignDialect | null {
  if (!code) return null;
  if (PLANTUML_FENCE.test(code)) return "plantuml";
  if (extractMermaidSource(code) !== null) return "mermaid";
  return null;
}

// Content a Mermaid macro cannot render although the user meant it to.
// `plantuml`: the source is PlantUML (`@startuml`), which needs the PlantUML
// tab. `leading_text`: prose (for example a Markdown heading) sits above a
// real Mermaid opener, so Mermaid stops at line 1 with "No diagram type
// detected". Mermaid accepts only blank lines, `%%` comments/directives and a
// YAML front-matter block above the opener, so any other line there is an
// error — this cannot fire on source that Mermaid would render.
// `markdown_document`: prose plus two or more Mermaid openers — a Markdown
// document holding several diagrams, which only the Markdown tab can render.
export type MermaidForeignContent = "plantuml" | "leading_text" | "markdown_document";

function openerLines(code: string): { lines: string[]; leadingTextEnd: number | null; openers: number[] } {
  const lines = code.split(/\r\n|\r|\n/);
  let i = 0;
  if (lines[0]?.trim() === "---") {
    let j = 1;
    while (j < lines.length && lines[j].trim() !== "---") j++;
    if (j < lines.length) i = j + 1;
  }
  const meaningful: number[] = [];
  for (let k = i; k < lines.length; k++) {
    if (!isBlank(lines[k]) && !isMermaidCommentOrDirective(lines[k])) meaningful.push(k);
  }
  const nextOf = (n: number) => (n + 1 < meaningful.length ? lines[meaningful[n + 1]] : null);
  const openers = meaningful.filter((_, n) => isMermaidOpener(lines[meaningful[n]], nextOf(n)));
  const leadingText = meaningful.length > 0 && openers.length > 0 && openers[0] !== meaningful[0];
  return { lines, leadingTextEnd: leadingText ? openers[0] : null, openers };
}

function leadingTextEnd(code: string): number | null {
  return openerLines(code).leadingTextEnd;
}

export function detectForeignContentInMermaid(code: string | null | undefined): MermaidForeignContent | null {
  if (!code) return null;
  if (PLANTUML_FENCE.test(code)) return "plantuml";
  const { leadingTextEnd: end, openers } = openerLines(code);
  if (end === null) return null;
  return openers.length > 1 ? "markdown_document" : "leading_text";
}

// Keeps the author's text: each non-blank line above the Mermaid opener
// becomes a `%%` comment, which Mermaid ignores. Returns `code` unchanged when
// there is no leading text.
export function commentOutLeadingText(code: string): string {
  const end = leadingTextEnd(code);
  if (end === null) return code;
  const lines = code.split(/\r\n|\r|\n/);
  return lines
    .map((line, index) =>
      index < end && !isBlank(line) && !isMermaidCommentOrDirective(line) ? `%% ${line}` : line,
    )
    .join("\n");
}

const MARKDOWN_HEADING = /^#{1,6}\s/;

// Markdown source for the Markdown tab: prose stays as written and each
// Mermaid diagram (from its opener to the next Markdown heading or the next
// opener) is wrapped in a ```mermaid fence. Blank lines at the end of a
// diagram stay outside its fence.
export function toMarkdownDocument(code: string): string {
  const { lines, openers } = openerLines(code);
  const starts = new Set(openers);
  const out: string[] = [];
  let inside = false;
  let pendingBlank: string[] = [];
  const close = () => {
    out.push("```", ...pendingBlank);
    pendingBlank = [];
    inside = false;
  };
  lines.forEach((line, index) => {
    if (inside && (MARKDOWN_HEADING.test(line) || starts.has(index))) close();
    if (!inside && starts.has(index)) {
      out.push("```mermaid");
      inside = true;
    }
    if (inside && isBlank(line)) {
      pendingBlank.push(line);
      return;
    }
    if (inside) {
      out.push(...pendingBlank);
      pendingBlank = [];
    }
    out.push(line);
  });
  if (inside) close();
  return out.join("\n");
}
