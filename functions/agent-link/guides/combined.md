# Writing diagram DSL for update_diagram

This link is bound to ONE diagram of ONE type. Call read_diagram first to see
its `diagramType`, then send the FULL replacement `dsl` in that type's DSL.
`rendered:true` means it PARSED, not that it says what you meant.

## Minimal-edit contract (read FIRST — the single biggest quality lever)
You are REPAIRING the bound diagram, not redesigning it. Change ONLY what
makes the reported error go away; preserve everything else byte-for-byte
(labels, order, style, comments); add nothing the error did not require. A
no-op is a failure, not a safe default — if the DSL already parses and you
can't find the problem, don't return it unchanged; make one small, safe
cosmetic touch instead. The dialect-specific guide (below) has the full
contract and worked examples.

## Pick the right dialect and DO NOT blend them (the #1 real failure)

The most common way agents break these diagrams is mixing one DSL's syntax into
another. Match the bound `diagramType` to its dialect and stay inside it:

| diagramType | Dialect | Starts with | Conditionals / structure |
|---|---|---|---|
| `sequence` | **ZenUML** | messages directly (no header) | `if (c) { } else { }`, `while (c) { }` — NO `alt`, no `@startuml` |
| `mermaid` | **Mermaid** | the diagram type (`flowchart TD`, `sequenceDiagram`) | flowchart edges, or `sequenceDiagram` `alt`/`loop`/`end` |
| `plantuml` | **PlantUML** | `@startuml` … `@enduml` | sub-type inferred from body keywords |

Constructs that get wrongly blended — keep each in its own column:
- `sequenceDiagram` / `stateDiagram-v2` / `flowchart` headers → Mermaid only.
- `@startuml` / `@enduml` → PlantUML only.
- `alt … else … end` → Mermaid/PlantUML; ZenUML uses `if (c) { } else { }`.
- `@Actor` / `@Database` annotations → ZenUML only; PlantUML uses bare
  `actor "X" as Y`.
- `A->>B:` / `A-->>B:` async arrows → Mermaid sequence; ZenUML uses `A->B:`.

## The one rule that spans all three
Quote any label/alias containing punctuation — `(`, `)`, `#`, commas, spaces
in a name — and always use straight ASCII quotes (`"`), never curly/smart
quotes. Unquoted special characters are the single largest parse-failure family
in Mermaid and a recurring one in ZenUML and PlantUML.

## Get the dialect-specific guide
After read_diagram tells you the type, read the matching resource for the full,
failure-ranked rules and worked examples:
`zenuml://dsl-guide`, `mermaid://dsl-guide`, or `plantuml://dsl-guide`.

If the bound diagramType is Graph, OpenApi, AsyncApi, or Embed, none of the
above applies — use that tool's own native format (DrawIO XML, OpenAPI/AsyncAPI
YAML) unchanged.