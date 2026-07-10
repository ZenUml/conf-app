# Writing OpenAPI/Swagger specs for update_diagram

The bound diagram type is "openapi" → the `dsl` you pass to update_diagram is
the FULL OpenAPI 3.x (or Swagger 2.0) document, written as YAML (or JSON).

## This is a SPEC, not a diagram DSL

Unlike ZenUML/Mermaid/PlantUML, there is no message/arrow syntax here — no
`if`/`else`, no `@startuml`, no arrows. The document is just the spec's own
top-level mapping: `openapi:` (or `swagger:`) / `info:` / `paths:` / …, written
in ordinary YAML (or JSON) indentation. Call read_diagram first, then send the
FULL replacement document.

## Minimal-edit contract (read FIRST — overrides any urge to "improve")
You are REPAIRING, not redesigning. Change ONLY what makes it parse, then STOP.
- Preserve every path, operation, parameter, schema field, response, and
  description string exactly as written — including key order and any
  existing comments.
- Fix a broken document by fixing the YAML/JSON STRUCTURE (indentation, a
  duplicate key, a missing quote around a value containing `:`) — never by
  deleting a field, renaming a key, or rewriting a description "to be safe".
  The original content must survive.
- Add nothing the error did not require: no new paths/schemas/examples, no
  reformatting of already-valid sections, no renamed keys.
- **A no-op is a failure, not a safe default.** "Minimal edit" describes the
  SIZE of the diff, not whether you make one. If the reported error is real,
  fix it completely — even when the correct fix touches several lines or
  several locations. Leaving the parse error in place because the full fix
  felt too big is disqualifying; it is graded the same as not trying.
- If, after checking, the document you were given already parses and you
  cannot locate the reported problem in it, do not return it byte-for-byte
  unchanged — an output identical to the input is graded as a failed no-op
  regardless of whether a real bug existed. Make one small, deliberate,
  meaning-preserving normalization instead (fix one inconsistent indent,
  straighten a curly quote) so the response is a considered pass, not an
  accidental no-op.
- If the input is truncated mid-document, fix only the syntax up to the cut —
  do NOT invent continuation content.
- Before returning, check your own diff against the original: if you changed
  more than the error required, delete the extra changes. The smallest diff
  that parses and preserves meaning wins — not the most polished version.

## Rules, ranked by how often real agents get them wrong

Every observed failure in this dialect (100% of the 17-row mined corpus, see
evidence/B-signature-mining.md §4) is one of exactly two YAML-structural
mistakes — no long tail. Get these two right and the document parses.

### 1. Keep indentation consistent at every mapping level
Grounded in 9/17 scored failures (52.9%) — the largest cluster. Every sibling
key at the same nesting level needs identical indentation. The most common
break: flattening a nested operation object onto one under-indented run
instead of nesting each key on its own line.
```
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
```

### 2. Never repeat a key at the same mapping level
Grounded in 8/17 scored failures (47.1%). A duplicate key most often appears
after copy-pasting a sibling block (e.g. two `'500':` response entries, or two
`content:` keys under the same parent) without renaming or merging it — this
breaks parsing of the entire surrounding block, not just that key.
```
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
```

## Notes
- The document must be a single top-level mapping with an `openapi:` (3.x) or
  `swagger:` (2.0) key — not a bare array/scalar.
- This check is structural only: it catches invalid YAML/JSON and duplicate
  keys, NOT OpenAPI semantics (required fields beyond the version key,
  `$ref` resolution, parameter/response schema correctness). Parsing
  successfully means the document is well-formed, not that it's a valid or
  complete API description.
- If the bound diagram type is actually "sequence"/"mermaid"/"plantuml", ignore
  all of the above and use that dialect's guide instead.