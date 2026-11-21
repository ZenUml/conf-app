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
