# Writing ZenUML sequence DSL for update_diagram

The bound diagram type is "sequence" → the `dsl` you pass to update_diagram
must be **ZenUML** sequence DSL. Call read_diagram first, then send the FULL
replacement DSL. `rendered:true` means the DSL PARSED, not that it says what
you meant — for a complex diagram, read it back and confirm the nesting.

## Minimal-edit contract (read FIRST — overrides any urge to "improve")
You are REPAIRING, not redesigning. Change ONLY what makes it parse, then STOP.
- Preserve every participant, annotation (`@Actor`, `@Database`, …), message,
  return, condition, comment, nesting order and control-flow block exactly as
  written.
- Fix a broken label by QUOTING the offending punctuation — never by deleting
  the parenthetical, shortening the message text, or rewording it "to be
  safe". The visible text must survive.
- Add nothing the error did not require: no new participants/messages, no
  extra control-flow blocks (`if`/`while`/`opt`/`par`/`try`), no renamed
  identifiers, no reordering of existing statements.
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

## This is ZenUML — NOT Mermaid or PlantUML

The single biggest failure mode in real usage is blending another DSL's
syntax into ZenUML. If you catch yourself writing any of the left column,
stop and use the right column instead:

| You might reach for (Mermaid / PlantUML) | ZenUML actually uses |
|---|---|
| `sequenceDiagram` header line | no header — start with messages directly |
| `@startuml` / `@enduml` wrapper | none |
| `alt cond … else … end` | `if (cond) { } else { }` (there is NO `alt` keyword) |
| `loop cond … end` (+ else) | `while (cond) { }` (loop has NO else) |
| `A->>B: msg` / `A-->>B: msg` | `A->B: msg` |
| `participant API as X` first-class | participants are inferred; declare with `@Actor X` or `Long Name as X` |
| `@Actor "X" as Y` (quoted string) | `@Actor X` annotator, no quoted-string alias form |
| `note right of X` | `// a line comment` |

## Messages
- `A.method(args)`        sync call to A (auto activation + return)
- `A->B.method(args)`     sync call from A to B
- `A->B: message`         plain async message from A to B (fire-and-forget)
- `x = A.method()`        capture the returned value
- `return value`          reply, inside a method's { } block
- `new B()` / `b = new B()`   object creation

## Rules, ranked by how often real agents get them wrong

### 1. Pick sync OR async per message — never bolt a { } body onto `A->B: label`
Grounded in 199/425 generation failures (46.8%) + scored corpus rows. ZenUML
has two message shapes for two meanings: an **async** `A->B: label` is
fire-and-forget and takes NO trailing brace block; a **sync** call
`A.method(){ }` or `A->B.method(){ }` is the only form that may carry a
nested `{ }` body. Attaching a body to a label message is the #1 parse error.
```
// WRONG — "mismatched input '}' expecting <EOF>"
Client->Gateway: requestList() {
  Gateway.validate()
}
// RIGHT — switch the connector to a sync call; keep the nesting
Client->Gateway.requestList() {
  Gateway.validate()
}
```
When quoting a call argument, the quotes wrap only the string argument
(`isValid("id")`), never the method name or the whole call.

### 2. Conditionals are `if (cond) { } else { }` only — no `alt`, and `loop` has no `else`
Grounded in a scored diagram resubmitted 3× + ~4-5% of generation failures;
the production generation prompt itself teaches the invalid
`loop(cond){ } else { }` shape, so agents inherit it. There is no `alt`
keyword anywhere in the lexer, and a `while`/`for`/`loop` block cannot be
followed by `else`.
```
// WRONG — "mismatched input 'else' expecting <EOF>"
alt forceEnroll {
  Service.activate()
} else {
  Service.setup()
}
// RIGHT
if (forceEnroll) {
  Service.activate()
} else {
  Service.setup()
}
```

### 3. An `if (…)` condition is EITHER bare words OR an operator expression — never both
Grounded in a scored diagram resubmitted 3× + 42/425 generation failures
(9.9%). The grammar accepts a condition that is bare multi-word text with no
operators (`if (user confirmed order)`) OR a boolean expression built from
**single-token** atoms and `&&`/`||`/`!`/comparisons — but mixing free
multi-word phrases with operators breaks the parse.
```
// WRONG — "missing '{' at 'param'"
if (no location param && !bot) { }
// RIGHT — single-token atoms on both sides of &&
if (!hasLocationParam && !bot) { }
```

### 4. Reply with bare `return <expr>`; reserve `@return Sender->Receiver: label` for explicit targets
Grounded in 43/425 generation failures (10.1%). Inside a nested call body,
`return value` replies to the immediate caller. `@return` is also valid but
requires the full arrow+colon target after it (`@return B->A: result`) — it is
NOT a synonym for bare `return`, and using it without a target is a parse error.

### 5. Quote any label that contains punctuation
Grounded in a scored no-op diagram + ~5% of generation failures. Parentheses,
commas, colons as free text inside a message/return label start a real
expression and break the parse unless the whole label is a quoted string.
```
// WRONG — "extraneous input 'Numbers' expecting ')'"
return Return List Items (with Article Numbers)
// RIGHT
return "Return List Items (with Article Numbers)"
```

### 6. Declare every participant/annotation before its first use
Grounded in a scored data-loss row. Group participant declarations and
annotators (`@Actor User`, `@Database DB`) at the top; introducing
`@EC2 <<Digital>> CheckoutService` mid-file, after messages have started, is a
parse error.

### 7. In deep nesting, close one block before opening the next; count braces
Grounded in a scored meaning-changed row. The reported error line is often
downstream of the real defect (the parser recovers past a missing/extra brace
and only fails later) — when an `else`/`}` looks orphaned, check the brace
balance several statements EARLIER, not at the reported line.

### 8. Identifiers never start with a digit
Grounded in a scored clean-fix row. `OrderService.1create()` is invalid; a
name must start with a letter or underscore.

## Full control-flow syntax (all grammar-backed)
```
if (cond) { A.doThis() } else if (cond) { A.doThat() } else { A.fallback() }
while (cond) { A.retry() }          // for / forEach / loop are synonyms
opt (cond) { A.maybe() }            // optional fragment
par { A.first()  B.second() }       // parallel
critical { A.locked() }             // critical region
section(label) { A.step() }         // labeled frame (frame(label){ } too)
try { A.risky() } catch (e) { A.handle() } finally { A.cleanup() }
```
- Nest calls inside a caller block: `A.method() { B.other() }`
- Comments: `// like this`
- If the bound diagram type is actually "mermaid" or "plantuml", ignore all of
  the above and use that dialect's guide instead.