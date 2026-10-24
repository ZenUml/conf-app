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
// comments/init directives, a leading YAML front-matter block, and a leading
// markdown fence), matched case-sensitively, and keywords that double as
// identifiers (`graph`, `flowchart`) additionally require a trailing
// direction token so `graph.render()` and a bare `graph` participant line do
// not match.
export type ForeignDialect = "plantuml" | "mermaid";

const PLANTUML_FENCE = /^\s*@startuml\b/im;

// Simple Mermaid diagram openers: the keyword must be followed by whitespace,
// end of line, or end of input.
const MERMAID_SIMPLE_KEYWORDS =
  /^(erDiagram|sequenceDiagram|classDiagram|stateDiagram-v2|stateDiagram|gantt|pie|mindmap|gitGraph|journey|timeline)(?=\s|$)/;

// `flowchart`/`graph` require an explicit direction token — a bare `graph`
// or `flowchart` line (or `graph.render()`) is not enough to call it Mermaid.
const MERMAID_DIRECTIONAL_KEYWORDS = /^(flowchart|graph)\s+(TB|TD|BT|RL|LR)(?=\s|$)/;

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function isMermaidCommentOrDirective(line: string): boolean {
  return line.trim().startsWith("%%");
}

// Strips leading blank lines, `%%` comments/init directives, a leading YAML
// front-matter block (`---` ... `---`), and a leading markdown fence line
// (``` or ```mermaid), then returns the first remaining non-blank line —
// i.e. the "first meaningful line" Mermaid detection is anchored to.
function firstMeaningfulLine(code: string): string | null {
  const lines = code.split(/\r\n|\r|\n/);
  let i = 0;

  // Leading YAML front matter.
  if (i < lines.length && lines[i].trim() === "---") {
    let j = i + 1;
    while (j < lines.length && lines[j].trim() !== "---") j++;
    if (j < lines.length) {
      i = j + 1;
    }
  }

  while (i < lines.length) {
    const line = lines[i];
    if (isBlank(line) || isMermaidCommentOrDirective(line)) {
      i++;
      continue;
    }
    if (/^```(mermaid)?\s*$/.test(line.trim())) {
      i++;
      continue;
    }
    return line;
  }
  return null;
}

function detectMermaid(code: string): boolean {
  const line = firstMeaningfulLine(code);
  if (line === null) return false;
  const trimmed = line.trimStart();
  return MERMAID_SIMPLE_KEYWORDS.test(trimmed) || MERMAID_DIRECTIONAL_KEYWORDS.test(trimmed);
}

export function detectForeignDialect(code: string | null | undefined): ForeignDialect | null {
  if (!code) return null;
  if (PLANTUML_FENCE.test(code)) return "plantuml";
  if (detectMermaid(code)) return "mermaid";
  return null;
}
