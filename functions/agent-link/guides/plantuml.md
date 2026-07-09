# Writing PlantUML DSL for update_diagram

The bound diagram type is "plantuml" → the `dsl` you pass to update_diagram
must be **PlantUML** DSL. Call read_diagram first, then send the FULL
replacement DSL. The whole diagram is wrapped in exactly one
`@startuml` … `@enduml` pair; PlantUML infers the sub-type (sequence /
activity / class / usecase / component / state / ER) from the keywords in the
body.

## This is PlantUML — NOT Mermaid or ZenUML

Blending another DSL's syntax into PlantUML is the #1 failure mode, and it
happens in every direction. If you catch yourself writing the left column, use
the right column instead:

| You might reach for (Mermaid / ZenUML) | PlantUML actually uses |
|---|---|
| `sequenceDiagram` / `stateDiagram-v2` / `flowchart` header + `autonumber` | no such header — just `@startuml` then the body; `autonumber` is fine on its own line |
| Mermaid state syntax `[*] --> Draft` | PlantUML state syntax `[*] --> Draft` only inside a state-diagram body (don't mix with sequence arrows) |
| Mermaid arrows `A-->>B:` / `A->>B:` | `A -> B:` / `A --> B:` |
| ZenUML `@Actor "X" as Y` / `@Participant "X" as Y` | `actor "X" as Y` / `participant "X" as Y` (no `@` prefix) |

## Rules, ranked by how often real agents get them wrong

### 1. Don't mix construct families from two PlantUML sub-types in one diagram
Grounded in 5/22 scored failures (22.7%) — the largest PlantUML cluster.
PlantUML picks ONE sub-type from the body keywords. Don't combine activity-
diagram constructs (`partition`, `start`/`stop`, `:action;`, swimlanes
`|Lane|`) with sequence-diagram constructs (`participant`, `box … end box`,
`A -> B:` arrows) in the same diagram, and never paste a Mermaid diagram-type
header at the top.
```
// WRONG — activity syntax inside a body PlantUML reads as a sequence diagram
partition "Team A" {
}
|Contractor|
start
:Do the stocktake;
// RIGHT — sequence-diagram grouping + a sequence message
box "Team A"
end box
Contractor -> Contractor: Do the stocktake
```

### 2. Declare style/color constants only via `!define NAME value`
Grounded in 3/22 scored failures (13.6%). Use the real preprocessor directive —
not an invented function-call directive, and don't create a `!define ALIAS
realKeyword` macro that just renames a builtin (e.g. aliasing `class`); use the
builtin keyword directly.
```
// WRONG — hallucinated pseudo function-call
SET_ELEMENT_COLOR(#FFFFFF)
// RIGHT
!define ELEMENT_COLOR #FFFFFF
```

### 3. Quote multi-word/non-ASCII aliases; always use straight ASCII quotes
Grounded in 2/22 scored failures (9.1%). An actor/participant alias containing
spaces or non-ASCII characters must be quoted, and the quotes must be straight
ASCII `"` — never curly/smart quotes (`“ ” ‘ ’`), which LLM text generation
inserts by habit. (This straight-quote rule holds for every dialect.)
```
// WRONG — unquoted multi-word participant
Data Store -> Cache: fetch record
// RIGHT
"Data Store" -> Cache: fetch record
```

### 4. Exactly one `@startuml` / `@enduml` pair — check before adding another
Grounded in 2/22 scored failures (9.1%). On a modify/regenerate pass the
envelope is easy to duplicate; before wrapping, check whether the content
already starts with `@startuml` and ends with `@enduml`.
```
// WRONG — the wrapper appears twice
@startuml
@startuml Flow
...
@enduml
// RIGHT — one pair
@startuml Flow
...
@enduml
```

### 5. A `note` position keyword always needs `of`
Grounded in a scored failure. Write `note right of X`, `note left of X`,
`note over X` — never `note right X`.

### 6. Declare actors/participants with bare `actor` / `participant` — no `@` prefix
Grounded in a scored clean-fix (the mirror image of ZenUML's `@`-annotation
signature — LLMs blend both directions). PlantUML has no `@Actor`/`@Participant`
annotation syntax; that is ZenUML's convention.
```
// WRONG
@Actor "CI Pipeline" as CI
@Participant "Test Runner" as Server
// RIGHT
actor "CI Pipeline" as CI
participant "Test Runner" as Server
```

### 7. Every reference must match a currently-declared id — check after a rename
Grounded in a scored failure. `Rel(customer, asis, "Uses")` where `asis` was
renamed `frontend` elsewhere leaves a dangling reference; update every
relationship/association call after renaming a participant.

## Notes
- The body sub-type is inferred — keep every statement within the one family
  you started with.
- If the bound diagram type is actually "sequence" (ZenUML) or "mermaid",
  ignore all of the above and use that dialect's guide instead.