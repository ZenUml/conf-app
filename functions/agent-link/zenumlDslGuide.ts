// ZenUML DSL guidance surfaced to the connected agent so ANY MCP client
// (Claude Code, Cursor, …) writes valid ZenUML sequence syntax on the first
// try, instead of guessing Mermaid/PlantUML-style control flow and getting a
// `rendered: false` / guardrail-rejected retry loop. Served three ways
// (mcp.ts): the `initialize` result's `instructions`, the `zenuml://dsl-guide`
// resource (resources/read), and a one-liner appended to the `update_diagram`
// tool description (mcpTools.ts). Also mirrored to guides/zenuml.md for the
// offline eval (Track E1) — see dslGuides.ts + guides.spec.ts.
//
// DATA-DRIVEN, not memory: the rules below are ranked by real, sanitized
// AI-Repair failure signatures mined from the diagram-modification corpus and
// the generation-failure population (see
// evidence/B-signature-mining.md §1). Every prescriptive claim was
// independently verified against the ZenUML grammar
// (zenuml-core sequenceParser.g4 + sequenceLexer.g4), read directly — the
// [gen-failed] validator messages are self-contradictory and are used only as
// an aggregate volume signal (§0.5 of the mining doc). Each rule carries a real
// before/after example (identifiers genericised for client privacy — the
// syntactic shape of the bug is preserved) and a "grounded in N failures" note.
//
// Grammar facts this guide encodes (transcribed, not inferred):
//   asyncMessage: (from ARROW)? to COL content   (ARROW '->')  — no brace body
//   message / fromTo: sync call `A.method(){ }` / `A->B.method(){ }` — body OK
//   alt : ifBlock elseIfBlock* elseBlock?   ifBlock: IF parExpr braceBlock
//     -> the ONLY conditional-with-else; there is NO `alt` keyword in the lexer
//   loop: WHILE parExpr? braceBlock  (WHILE = while|for|foreach|forEach|loop)
//     -> loop has NO `else` continuation
//   condition: atom | expr | inExpr | textExpr   textExpr: ID+  (bare words OR
//     an operator expression over single-token atoms — never mixed)
//   ret: RETURN expr? SCOL? | ANNOTATION_RET asyncMessage EVENT_END?
//     (ANNOTATION_RET = @Return|@return|@Reply|@reply)

/** Full ZenUML DSL reference — used for `initialize.instructions` + the resource. */
export const ZENUML_DSL_GUIDE = `# Writing ZenUML sequence DSL for update_diagram

The bound diagram type is "sequence" → the \`dsl\` you pass to update_diagram
must be **ZenUML** sequence DSL. Call read_diagram first, then send the FULL
replacement DSL. \`rendered:true\` means the DSL PARSED, not that it says what
you meant — for a complex diagram, read it back and confirm the nesting.

## This is ZenUML — NOT Mermaid or PlantUML

The single biggest failure mode in real usage is blending another DSL's
syntax into ZenUML. If you catch yourself writing any of the left column,
stop and use the right column instead:

| You might reach for (Mermaid / PlantUML) | ZenUML actually uses |
|---|---|
| \`sequenceDiagram\` header line | no header — start with messages directly |
| \`@startuml\` / \`@enduml\` wrapper | none |
| \`alt cond … else … end\` | \`if (cond) { } else { }\` (there is NO \`alt\` keyword) |
| \`loop cond … end\` (+ else) | \`while (cond) { }\` (loop has NO else) |
| \`A->>B: msg\` / \`A-->>B: msg\` | \`A->B: msg\` |
| \`participant API as X\` first-class | participants are inferred; declare with \`@Actor X\` or \`Long Name as X\` |
| \`@Actor "X" as Y\` (quoted string) | \`@Actor X\` annotator, no quoted-string alias form |
| \`note right of X\` | \`// a line comment\` |

## Messages
- \`A.method(args)\`        sync call to A (auto activation + return)
- \`A->B.method(args)\`     sync call from A to B
- \`A->B: message\`         plain async message from A to B (fire-and-forget)
- \`x = A.method()\`        capture the returned value
- \`return value\`          reply, inside a method's { } block
- \`new B()\` / \`b = new B()\`   object creation

## Rules, ranked by how often real agents get them wrong

### 1. Pick sync OR async per message — never bolt a { } body onto \`A->B: label\`
Grounded in 199/425 generation failures (46.8%) + scored corpus rows. ZenUML
has two message shapes for two meanings: an **async** \`A->B: label\` is
fire-and-forget and takes NO trailing brace block; a **sync** call
\`A.method(){ }\` or \`A->B.method(){ }\` is the only form that may carry a
nested \`{ }\` body. Attaching a body to a label message is the #1 parse error.
\`\`\`
// WRONG — "mismatched input '}' expecting <EOF>"
Client->Gateway: requestList() {
  Gateway.validate()
}
// RIGHT — switch the connector to a sync call; keep the nesting
Client->Gateway.requestList() {
  Gateway.validate()
}
\`\`\`
When quoting a call argument, the quotes wrap only the string argument
(\`isValid("id")\`), never the method name or the whole call.

### 2. Conditionals are \`if (cond) { } else { }\` only — no \`alt\`, and \`loop\` has no \`else\`
Grounded in a scored diagram resubmitted 3× + ~4-5% of generation failures;
the production generation prompt itself teaches the invalid
\`loop(cond){ } else { }\` shape, so agents inherit it. There is no \`alt\`
keyword anywhere in the lexer, and a \`while\`/\`for\`/\`loop\` block cannot be
followed by \`else\`.
\`\`\`
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
\`\`\`

### 3. An \`if (…)\` condition is EITHER bare words OR an operator expression — never both
Grounded in a scored diagram resubmitted 3× + 42/425 generation failures
(9.9%). The grammar accepts a condition that is bare multi-word text with no
operators (\`if (user confirmed order)\`) OR a boolean expression built from
**single-token** atoms and \`&&\`/\`||\`/\`!\`/comparisons — but mixing free
multi-word phrases with operators breaks the parse.
\`\`\`
// WRONG — "missing '{' at 'param'"
if (no location param && !bot) { }
// RIGHT — single-token atoms on both sides of &&
if (!hasLocationParam && !bot) { }
\`\`\`

### 4. Reply with bare \`return <expr>\`; reserve \`@return Sender->Receiver: label\` for explicit targets
Grounded in 43/425 generation failures (10.1%). Inside a nested call body,
\`return value\` replies to the immediate caller. \`@return\` is also valid but
requires the full arrow+colon target after it (\`@return B->A: result\`) — it is
NOT a synonym for bare \`return\`, and using it without a target is a parse error.

### 5. Quote any label that contains punctuation
Grounded in a scored no-op diagram + ~5% of generation failures. Parentheses,
commas, colons as free text inside a message/return label start a real
expression and break the parse unless the whole label is a quoted string.
\`\`\`
// WRONG — "extraneous input 'Numbers' expecting ')'"
return Return List Items (with Article Numbers)
// RIGHT
return "Return List Items (with Article Numbers)"
\`\`\`

### 6. Declare every participant/annotation before its first use
Grounded in a scored data-loss row. Group participant declarations and
annotators (\`@Actor User\`, \`@Database DB\`) at the top; introducing
\`@EC2 <<Digital>> CheckoutService\` mid-file, after messages have started, is a
parse error.

### 7. In deep nesting, close one block before opening the next; count braces
Grounded in a scored meaning-changed row. The reported error line is often
downstream of the real defect (the parser recovers past a missing/extra brace
and only fails later) — when an \`else\`/\`}\` looks orphaned, check the brace
balance several statements EARLIER, not at the reported line.

### 8. Identifiers never start with a digit
Grounded in a scored clean-fix row. \`OrderService.1create()\` is invalid; a
name must start with a letter or underscore.

## Full control-flow syntax (all grammar-backed)
\`\`\`
if (cond) { A.doThis() } else if (cond) { A.doThat() } else { A.fallback() }
while (cond) { A.retry() }          // for / forEach / loop are synonyms
opt (cond) { A.maybe() }            // optional fragment
par { A.first()  B.second() }       // parallel
critical { A.locked() }             // critical region
section(label) { A.step() }         // labeled frame (frame(label){ } too)
try { A.risky() } catch (e) { A.handle() } finally { A.cleanup() }
\`\`\`
- Nest calls inside a caller block: \`A.method() { B.other() }\`
- Comments: \`// like this\`
- If the bound diagram type is actually "mermaid" or "plantuml", ignore all of
  the above and use that dialect's guide instead.`;

/** One-liner appended to the update_diagram tool description (kept short). */
export const ZENUML_DSL_TOOL_HINT =
  'This "sequence" diagram uses ZenUML DSL (NOT Mermaid/PlantUML): messages ' +
  '`A.method()` / `A->B: msg`; control flow `if(c){}else{}`, `while(c){}`, ' +
  '`opt(c){}`, `par{}`, `try{}catch(e){}`. No `alt` keyword; never attach a ' +
  '`{}` body to a `A->B: label` message; quote labels containing punctuation. ' +
  'Full guide: the `zenuml://dsl-guide` resource.';

/** URI of the guide exposed via resources/list + resources/read. */
export const ZENUML_DSL_GUIDE_URI = 'zenuml://dsl-guide';
