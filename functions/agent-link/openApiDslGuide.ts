// OpenAPI/Swagger guidance surfaced to the connected agent when the bound
// diagram is an OpenAPI macro, so an MCP client writes a document that parses
// on the first try instead of tripping the two YAML-structural mistakes that
// account for 100% of the mined corpus's OpenAPI failures. Served the same
// three ways as the diagram-DSL guides (mcp.ts + mcpTools.ts) and mirrored to
// guides/openapi.md for Track E1.
//
// Deliberately smaller than the three diagram-DSL guides: OpenAPI is a SPEC,
// not a diagram DSL the agent authors statement-by-statement, and the mined
// corpus (17 scored rows, see evidence/B-signature-mining.md §4) is unusually
// clean — exactly two YAML-structural signatures cover every observed
// failure, no long tail. A full OpenAPI/JSON-Schema authoring guide would be
// disproportionate to that evidence.

/** Full OpenAPI/Swagger authoring reference — used for `initialize.instructions` + the resource. */
export const OPENAPI_DSL_GUIDE = `# Writing OpenAPI/Swagger specs for update_diagram

The bound diagram type is "openapi" → the \`dsl\` you pass to update_diagram is
the FULL OpenAPI 3.x (or Swagger 2.0) document, written as YAML (or JSON).

## This is a SPEC, not a diagram DSL

Unlike ZenUML/Mermaid/PlantUML, there is no message/arrow syntax here — no
\`if\`/\`else\`, no \`@startuml\`, no arrows. The document is just the spec's own
top-level mapping: \`openapi:\` (or \`swagger:\`) / \`info:\` / \`paths:\` / …, written
in ordinary YAML (or JSON) indentation. Call read_diagram first, then send the
FULL replacement document.

## Rules, ranked by how often real agents get them wrong

Every observed failure in this dialect (100% of the 17-row mined corpus, see
evidence/B-signature-mining.md §4) is one of exactly two YAML-structural
mistakes — no long tail. Get these two right and the document parses.

### 1. Keep indentation consistent at every mapping level
Grounded in 9/17 scored failures (52.9%) — the largest cluster. Every sibling
key at the same nesting level needs identical indentation. The most common
break: flattening a nested operation object onto one under-indented run
instead of nesting each key on its own line.
\`\`\`
// WRONG — summary/operationId flattened onto one indent level, not nested under get:
paths:
  /widgets:
    get: summary: list widgets
    operationId: listWidgets
// RIGHT — each key properly nested one level under its parent
paths:
  /widgets:
    get:
      summary: list widgets
      operationId: listWidgets
\`\`\`

### 2. Never repeat a key at the same mapping level
Grounded in 8/17 scored failures (47.1%). A duplicate key most often appears
after copy-pasting a sibling block (e.g. two \`'500':\` response entries, or two
\`content:\` keys under the same parent) without renaming or merging it — this
breaks parsing of the entire surrounding block, not just that key.
\`\`\`
// WRONG — '500' appears twice under the same responses: mapping
responses:
  '500':
    description: server error
  '500':
    description: another server error
// RIGHT — one entry per response code
responses:
  '500':
    description: server error
\`\`\`

## Notes
- The document must be a single top-level mapping with an \`openapi:\` (3.x) or
  \`swagger:\` (2.0) key — not a bare array/scalar.
- This check is structural only: it catches invalid YAML/JSON and duplicate
  keys, NOT OpenAPI semantics (required fields beyond the version key,
  \`$ref\` resolution, parameter/response schema correctness). Parsing
  successfully means the document is well-formed, not that it's a valid or
  complete API description.
- If the bound diagram type is actually "sequence"/"mermaid"/"plantuml", ignore
  all of the above and use that dialect's guide instead.`;

/** One-liner appended to the update_diagram tool description (kept short). */
export const OPENAPI_DSL_TOOL_HINT =
  'This "openapi" document is an OpenAPI/Swagger YAML or JSON spec (NOT a ' +
  'diagram DSL): keep indentation consistent at every mapping level, and ' +
  'never repeat a key at the same level (e.g. two `\'500\':` responses) — ' +
  'both break the whole parse. Full guide: the `openapi://dsl-guide` resource.';

/** URI of the guide exposed via resources/list + resources/read. */
export const OPENAPI_DSL_GUIDE_URI = 'openapi://dsl-guide';
