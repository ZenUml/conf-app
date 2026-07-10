# Writing PlantUML DSL for update_diagram

The bound diagram type is "plantuml" → the `dsl` you pass to update_diagram
must be **PlantUML** DSL. Call read_diagram first, then send the FULL
replacement DSL. The whole diagram is wrapped in exactly one
`@startuml` … `@enduml` pair; PlantUML infers the sub-type (sequence /
activity / class / usecase / component / state / ER) from the keywords in the
body.

## Minimal-edit contract (read FIRST — overrides any urge to "improve")
You are REPAIRING, not redesigning. Change ONLY what makes it parse, then STOP.
- Preserve every actor/participant, message, note, relation, label, comment,
  order and style/color directive exactly as written.
- Fix a broken alias or label by QUOTING/ESCAPING the offending characters —
  never by deleting the parenthetical, condensing multi-line text, or
  removing diacritics/non-ASCII characters. The visible text must survive.
- Add nothing the error did not require: no `autonumber`, no `skinparam`, no
  `legend`, no `== section dividers ==`, no new notes, no reworded messages,
  no renamed identifiers, no restructured `alt`/`else` blocks, and do not
  expand one relation into several.
- Do NOT strip diacritics or non-ASCII characters to "normalize" text.
- Do NOT condense a multi-line `note` block into a single prose sentence —
  preserve its original line breaks and bullet structure.
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

## This is PlantUML — NOT Mermaid or ZenUML

Blending another DSL's syntax into PlantUML is the #1 failure mode, and it
happens in every direction. If you catch yourself writing the left column, use
the right column instead:

| You might reach for (Mermaid / ZenUML) | PlantUML actually uses |
|---|---|
| `sequenceDiagram` / `stateDiagram-v2` / `flowchart` header + `autonumber` | no such header — just `@startuml` then the body; `autonumber` is fine on its own line |
| Mermaid state syntax `[*] --> Draft` | PlantUML state syntax `[*] --> Draft` only inside a state-diagram body (don't mix with sequence arrows) |
| ZenUML `@Actor "X" as Y` / `@Participant "X" as Y` | `actor "X" as Y` / `participant "X" as Y` (no `@` prefix) |

**Correction — `->>`/`-->>` ARE real PlantUML, not a Mermaid-ism:** an earlier
version of this table wrongly claimed `A-->>B:` / `A->>B:` "are Mermaid, not
PlantUML" and should be rewritten as `A --> B:` / `A -> B:`. **That is false
and must not be applied.** `->>` and `-->>` are real, native PlantUML arrow
tokens — `>>` is the "thin arrowhead" (async) style, independent of the
solid/dotted line choice, so all four of `->`, `-->`, `->>`, `-->>` are valid
and each renders visibly differently (verified against the official PlantUML
sequence-diagram docs and a real rendered comparison). **Do NOT "correct"
`->>`/`-->>` to `->`/`-->` in PlantUML — that silently converts every async
message to synchronous, changing the diagram's meaning.** If an input already
uses `->>`/`-->>`, leave it alone; those tokens are not a Mermaid-ism to fix.

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
There is no PlantUML construct that keeps an activity-only element (a
swimlane, `start`/`stop`, `partition`) working inside a sequence diagram or
vice versa — when the two families collide, the only valid fix is to keep the
family the rest of the diagram commits to and drop the intruding element(s).
That is a real, unavoidable loss of whatever those elements conveyed — it is
not a mistake to fix by trying harder.

### 2. Route a hallucinated `SET_SOMETHING(...)` style call through the REAL C4-PlantUML style macros — never through `!define`
Grounded in 3/22 scored failures (13.6%). A hallucinated call like
`SET_ELEMENT_COLOR(#FFFFFF)` or `SET_ELEMENT_DESCR_COLOR(#FFFFFF)` is not a
real preprocessor directive, and wrapping it in `!define NAME value` doesn't
fix it either — that parses, but C4-PlantUML's macro library never reads a
plain `!define`d constant for element styling, so that "fix" clears the parse
error while silently dropping the styling intent (verified against the real
C4-PlantUML macro-library source and a rendered comparison: the `!define`
version is pixel-identical to not styling the element at all).

The REAL C4-PlantUML mechanisms, confirmed against the official C4-PlantUML
README (github.com/plantuml-stdlib/C4-PlantUML) and a rendered before/after
comparison that visibly changes the output (unlike the inert `!define`):
- **`UpdateElementStyle(elementName, $bgColor=.., $fontColor=.., $borderColor=..,
  ...)`** — sets the DEFAULT style for every element of a given base type
  (`"person"`, `"system"`, `"container"`, `"component"`, etc.). Use this when
  the hallucinated call had no specific target and looks like a blanket
  default (as `SET_ELEMENT_DESCR_COLOR(#FFFFFF)` did — no element/tag
  argument, just a color).
- **`AddElementTag(tagName, $bgColor=.., $fontColor=.., $borderColor=.., ...)`**
  — defines a reusable style tag; apply it to specific elements via
  `$tags="tagName"` on their `Component(...)`/`Container(...)`/etc. call. Use
  this when the diagram already has (or the hallucinated call implies) a named
  category of elements to style, not every element of a type.
```
// WRONG — hallucinated pseudo function-call (parses nowhere; not real PlantUML)
SET_ELEMENT_DESCR_COLOR(#FFFFFF)
// ALSO WRONG — parses, but is a no-op: C4-PlantUML never reads this !define
!define ELEMENT_DESCR_COLOR #FFFFFF
// RIGHT — a real C4-PlantUML macro that actually changes the rendered style
UpdateElementStyle("component", $fontColor="#FFFFFF")
```
Do not delete the line just because you're unsure of the exact target — that
drops a styling intent the original stated, which the minimal-edit contract
forbids. When genuinely unsure whether the intent was "every element of this
type" vs. "just these tagged elements," prefer `UpdateElementStyle` on the
base type nearest the call's context (it is the closer analog to a blanket
`SET_..._COLOR` call with no element argument).

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

### 8. When a declared alias doesn't match how it's referenced, fix the DECLARATION — not the label text
PlantUML's declaration order is `participant "Display Name" as alias` — the
quoted text is what renders, the bare identifier after `as` is the id every
later message must use (e.g. `alias -> Other: ...`). If you find messages
already using an identifier that the current declaration does not expose as
its alias, the DECLARATION is backwards or stale, not the messages — fix the
declaration's `as` alias so it matches what the messages already reference.
```
// WRONG — messages use "BE", but the declaration's alias is "Backend API"
participant BE as "Backend API"
BE -> FE: ...
// RIGHT — alias matches what messages actually reference
participant "Backend API" as BE
BE -> FE: ...
```
Do not "fix" this by touching the messages or by rewriting the quoted display
text itself — the declaration's word order is the bug. This construct is also
where agents most often mistake a legitimate `->>`/`-->>` async arrow for a
Mermaid-ism and "correct" it instead of fixing the real declaration bug above
— see the correction earlier in this guide.

## Notes
- The body sub-type is inferred — keep every statement within the one family
  you started with.
- If the bound diagram type is actually "sequence" (ZenUML) or "mermaid",
  ignore all of the above and use that dialect's guide instead.