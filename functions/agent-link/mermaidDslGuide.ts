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

/** Full Mermaid DSL reference — used for `initialize.instructions` + the resource. */
export const MERMAID_DSL_GUIDE = `# Writing Mermaid DSL for update_diagram

The bound diagram type is "mermaid" → the \`dsl\` you pass to update_diagram must
be **Mermaid** DSL. Call read_diagram first, then send the FULL replacement DSL.
The first non-blank line must be the diagram type (\`flowchart TD\`,
\`sequenceDiagram\`, \`classDiagram\`, \`erDiagram\`, …).

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
