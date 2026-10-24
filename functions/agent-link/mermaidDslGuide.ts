// Mermaid DSL guidance surfaced to the connected agent when the bound diagram
// is a Mermaid macro, so an MCP client writes valid Mermaid on the first try
// instead of leaking markdown fences, mixing flowchart/sequence syntax, or
// leaving special characters unquoted (all real, ranked failure signatures).
// Served the same three ways as the ZenUML guide (mcp.ts + mcpTools.ts) and
// mirrored to guides/mermaid.md for the offline eval (Track E1).
//
// DATA-DRIVEN: rules ranked by sanitized AI-Repair failure signatures from the
// diagram-modification corpus (93 scored Mermaid rows — the largest, best-
// performing dialect) plus the generation-failure population. See
// evidence/B-signature-mining.md §2. Every before/after is a real corpus
// diff with identifiers genericised for client privacy; the syntactic shape of
// each bug is preserved.
//
// PORTED FROM THE OFFLINE EVAL (diagramly.ai-agent-link-eval, Track E1),
// guides-r1/mermaid-v3.md — round-1/2/3 winner. Paired judge-v2 clean-fix rate
// moved 18.1% -> 81.0% -> 87.9% across three iterations (see that repo's
// reports/E1-nonclean-attribution.md + reports/E1-ROUND23-SYNTHESIS.md).
// What changed vs. the previous version of this file:
//   - The "Minimal-edit contract" section (repair, don't redesign; a no-op is
//     a failure; don't return byte-identical input when you can't find the
//     bug) — the single biggest lever, +60pp class improvement.
//   - Rules #8-#10 (balanced activation shorthand, never quote sequence
//     message text, cylinder/circle quote-not-shape fixes).
//   - Rule #3's worked example: converting a flowchart-bracket participant
//     label to an `as` alias must preserve the label's own `<br/>` line
//     breaks (this was silently dropped in the two round-1 `<br/>`-drift
//     rows).
// Example identifiers are genericised for client privacy (this file's own
// dslGuides.spec.ts sanitization test guards against real corpus names
// leaking through).

/** Full Mermaid DSL reference — used for `initialize.instructions` + the resource. */
export const MERMAID_DSL_GUIDE = `# Writing Mermaid DSL for update_diagram

The bound diagram type is "mermaid" → the \`dsl\` you pass to update_diagram must
be **Mermaid** DSL. Call read_diagram first, then send the FULL replacement DSL.
The first non-blank line must be the diagram type (\`flowchart TD\`,
\`sequenceDiagram\`, \`classDiagram\`, \`erDiagram\`, …).

## Minimal-edit contract (read FIRST — overrides any urge to "improve")
You are REPAIRING, not redesigning. Change ONLY what makes it parse, then STOP.
- Preserve every node, edge, message, participant, note, label, comment, order,
  color/style directive and line break (\`<br/>\`) exactly as written.
- Fix a broken label by QUOTING/ESCAPING the offending characters — never by
  deleting the parenthetical, flattening multi-line text, replacing
  bullets/emoji, dropping punctuation, or removing diacritics. The visible
  text must survive.
- Add nothing the error did not require: no new nodes/edges/subgraphs, no
  title, no autonumber, no styling/classDef, no extra notes, no reworded
  messages, no participant declarations that were not already there.
- The quote-the-parens rule (rule #1 below) is for FLOWCHART node/edge labels
  only. Inside \`sequenceDiagram\`, message text after the colon is free text —
  do NOT quote its parens (see rule #9).
- **A no-op is a failure, not a safe default.** "Minimal edit" describes the
  SIZE of the diff, not whether you make one. If the reported error is real,
  fix it completely — even when the correct fix touches several lines or
  several locations. Leaving the parse error in place because the full fix
  felt too big is disqualifying; it is graded the same as not trying.
- If, after checking, the DSL you were given already parses and you cannot
  locate the reported problem in it, do not return it byte-for-byte
  unchanged — an output identical to the input is graded as a failed no-op
  regardless of whether a real bug existed. Make one small, deliberate,
  meaning-preserving normalization instead (straighten a curly quote to
  ASCII, tidy one inconsistent indent) so the response is a considered pass,
  not an accidental no-op.
- If the input is truncated mid-diagram, fix only the syntax up to the cut —
  do NOT invent continuation content.
- Before returning, check your own diff against the original: if you changed
  more than the error required, delete the extra changes. The smallest diff
  that parses and preserves meaning wins — not the most polished version.

## This is Mermaid — NOT ZenUML or PlantUML

Blending another DSL's syntax into Mermaid is a top failure mode. If you catch
yourself writing the left column, use the right column instead:

| You might reach for (ZenUML / PlantUML) | Mermaid actually uses |
|---|---|
| \`@startuml\` / \`@enduml\` wrapper | none — first line is the diagram type |
| ZenUML \`A.method()\` / \`if (c) { }\` brace control flow | flowchart nodes+edges, or \`sequenceDiagram\` with \`alt\`/\`loop\`/\`end\` |
| PlantUML \`participant X\` with no header | \`participant X\` only INSIDE \`sequenceDiagram\` |
| flowchart bracket label \`ID["Name"]\` inside \`sequenceDiagram\` | \`participant ID as Name\` |

## Rules, ranked by how often real agents get them wrong

### 1. Quote any label containing \`(\`, \`)\`, \`#\` or other special characters
Grounded in 22/93 scored failures (23.7%) — by far the single largest Mermaid
cluster. Mermaid's flowchart lexer reads a bare \`(\` as possibly opening a
round/stadium node shape, so an unquoted parenthesis in a label is ambiguous
and fails to parse. Wrap the WHOLE label in double quotes — never delete the
parenthetical to dodge the error (that silently changes the meaning).
\`\`\`
// WRONG — "Expecting 'SQE', 'DOUBLECIRCLEEND', … got …"
PR[Request<br/>(payload)]
// RIGHT
PR["Request<br/>(payload)"]
\`\`\`
The same applies to edge/pipe labels: \`A -->|"count (n)"| B\`.

### 2. Never leave markdown fences or prose in the diagram body
Grounded in 22/93 scored failures (23.7%): 15 still had the literal
\`\`\`\`mermaid\`\`\` / \`\`\`\`\`\`\`\` fence markers embedded in the body, 7 were raw prose
or document headings. The body is ONLY the DSL between the fences — strip the
fence markers and any surrounding text before submitting.

### 3. Inside \`sequenceDiagram\`, alias with \`as\` — not flowchart's bracket labels
Grounded in scored + generation failures. Flowchart's \`ID["label"]\` node
syntax does not exist inside a sequence diagram; participant aliasing uses the
\`as\` keyword with no brackets or quotes.
\`\`\`
// WRONG — "Lexical error … Unrecognized text"
sequenceDiagram
    participant API["Order<br/>Service"]
// RIGHT
sequenceDiagram
    participant API as Order Service
\`\`\`
Converting a bracket label to an \`as\` alias drops the label's own \`<br/>\` line
breaks more often than any other mistake in this rule — the model treats the
conversion as "flatten to plain text" instead of "reuse the same text
verbatim." The minimal-edit contract's \`<br/>\` preservation rule applies to
this conversion too:
\`\`\`
// WRONG — the bracket label had a <br/>, the \`as\` alias silently lost it
participant API["Auth Gateway<br/>Controller"]
-> participant API as Auth Gateway Controller
// RIGHT — the <br/> survives the conversion unchanged
participant API as Auth Gateway<br/>Controller
\`\`\`

### 4. Every \`subgraph\` needs a matching \`end\`; connect every subgraph node
Grounded in scored + 5/32 substantive generation failures. An unclosed
\`subgraph\` surfaces as a parse error many lines downstream — if the reported
error looks unrelated, check for an earlier unclosed \`subgraph\` first. Nodes
declared only inside a subgraph with no connecting edge are also flagged.

### 5. Flowchart/graph direction is always a 2-letter code
Grounded in a scored failure. Use exactly one of \`TD\` / \`TB\` / \`BT\` / \`RL\` /
\`LR\`: \`flowchart TD\`, never \`flowchart D\`.

### 6. Use Mermaid's ASCII arrow tokens — never a literal Unicode arrow glyph
Grounded in a scored lexical failure. Write \`-->\`, \`-.->\`, \`==>\` — never a
literal \`→\` / \`⇒\` character as a substitute (\`A -.-> B\`, not \`A -.→ B\`).

### 7. Prefix an alias declaration with \`participant\`
Grounded in a scored failure. \`A as Alpha\` alone is invalid — write
\`participant A as Alpha\`.

### 8. Balanced activation shorthand: every \`+\` needs a matching \`-\`
If you use \`->>+\` / \`->>-\` activation shorthand, every \`+\` must be matched by
a later \`-\` on the same participant. If you are not sure the pairing is
balanced after your edit, drop the \`+\`/\`-\` entirely and use plain \`->>\`
instead of guessing — an unbalanced activation marker is a parse error the
rest of this guide cannot fix.

### 9. Never quote sequence message text after the colon
In \`sequenceDiagram\`, rule #1's "wrap the label in quotes" does NOT apply to
message text after \`:\` — that text is already free-form. Never wrap it in \`"\`
and never insert an escaping \`"\` into it "to be safe"; doing so is itself a
common cause of NEW parse errors (over-quoting backfires) and is also a
scope-creep violation of the minimal-edit contract.

### 10. A cylinder \`X[("...")]\` or circle \`X((...))\` that fails to parse: fix the quotes, keep the shape
A failing cylinder/circle/rounded node is almost always an inner-quote
problem, not a shape problem. Do NOT downgrade it to a plain \`X["..."]\`
rectangle to make it parse — that silently deletes information the diagram
was using the shape to convey, which the minimal-edit contract forbids.

## Notes
- Comments start with \`%%\`.
- Node shapes: \`A[rect]\`, \`A(round)\`, \`A{diamond}\`, \`A((circle))\` — but any
  label text with special characters must be quoted regardless of shape.
- If the bound diagram type is actually "sequence" (ZenUML) or "plantuml",
  ignore all of the above and use that dialect's guide instead.`;

/** One-liner appended to the update_diagram tool description (kept short). */
export const MERMAID_DSL_TOOL_HINT =
  'This "mermaid" diagram uses Mermaid DSL (NOT ZenUML/PlantUML): first line is ' +
  'the diagram type (`flowchart TD`, `sequenceDiagram`, …). QUOTE any label ' +
  'containing `(`/`)`/`#` — `N["Request (payload)"]`; never leave ```` ```mermaid ```` ' +
  'fence markers in the body; inside `sequenceDiagram` alias with `as`, not ' +
  '`ID["…"]`. Full guide: the `mermaid://dsl-guide` resource.';

/** URI of the guide exposed via resources/list + resources/read. */
export const MERMAID_DSL_GUIDE_URI = 'mermaid://dsl-guide';
