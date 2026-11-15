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
//
// MINIMAL-EDIT CONTRACT: ported from the offline eval (diagramly.ai-agent-
// link-eval, Track E1) where it was the single biggest validated win for
// mermaid/plantuml (+60pp class improvement — see that repo's
// reports/E1-nonclean-attribution.md + reports/E1-ROUND23-SYNTHESIS.md).
// Applied here cross-dialect on the same "repair, don't redesign" reasoning;
// ZenUML was NOT individually A/B-tested for this section.

/** Full ZenUML DSL reference — used for `initialize.instructions` + the resource. */
export const ZENUML_DSL_GUIDE = `# Writing ZenUML sequence DSL for update_diagram

The bound diagram type is "sequence" → the \`dsl\` you pass to update_diagram
must be **ZenUML** sequence DSL. Call read_diagram first, then send the FULL
replacement DSL. \`rendered:true\` means the DSL PARSED, not that it says what
you meant — for a complex diagram, read it back and confirm the nesting.

## Minimal-edit contract (read FIRST — overrides any urge to "improve")
You are REPAIRING, not redesigning. Change ONLY what makes it parse, then STOP.
- Preserve every participant, annotation (\`@Actor\`, \`@Database\`, …), message,
  return, condition, comment, nesting order and control-flow block exactly as
  written.
- Fix a broken label by QUOTING the offending punctuation — never by deleting
  the parenthetical, shortening the message text, or rewording it "to be
  safe". The visible text must survive.
- Add nothing the error did not require: no new participants/messages, no
  extra control-flow blocks (\`if\`/\`while\`/\`opt\`/\`par\`/\`try\`), no renamed
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

/**
 * Compact ZenUML syntax for the render_diagram tool: put in its description and
 * appended to a failed sequence parse. Every example is run through the parser
 * in zenumlCheatSheet.spec.ts. Kept free of resource URIs (the render tool's
 * description must not name them).
 */
export const ZENUML_RENDER_CHEAT_SHEET =
  'ZenUML syntax: call with nested block `A->B.method() { C.other() }`; assign `x = B.get()`; ' +
  '`if (cond) { } else { }`; `return x`; `// comment`; participants `@Actor User`, `@Database DB`; ' +
  'quote names with spaces or slashes `B."GET /x"()`. Mistakes: no `{ }` block after an async ' +
  '`A->B: text` message (use `A->B.method() { }`); `group Name { A B }` only wraps participant ' +
  'declarations, so it goes before the first message and holds no messages.';

/** URI of the guide exposed via resources/list + resources/read. */
export const ZENUML_DSL_GUIDE_URI = 'zenuml://dsl-guide';

// ---- render_diagram lint ---------------------------------------------------
// Two ZenUML mistakes parse and still draw the wrong diagram, and two others
// fail with a parser error that points away from the cause. These checks are
// source scans, checked against the real parser in zenumlCheatSheet.spec.ts:
// - `group "x" { A->B: m }`: a group body holds only participant names, so the
//   parser ends the group at its name and reads the braces as a separate
//   block. The group draws empty.
// - `A->B: text { B->C: y }` on one line: the braces are part of the label.
// - `group` after the first message: "mismatched input 'group'".
// - `A->B: text {` with the block on later lines: the parser reports the
//   closing `}`, lines below the message that caused it.

export type ZenumlIssueCode =
  | 'group_with_messages'
  | 'block_in_async_message'
  | 'group_after_message'
  | 'block_after_async_message';

export interface ZenumlIssue {
  code: ZenumlIssueCode;
  /** 1-based line. */
  line: number;
  /** 0-based column. */
  col: number;
  /** One sentence: what goes wrong and the fix. */
  message: string;
}

/**
 * Blank out string contents and `//` comments, keeping every offset, so the
 * scans below see neither an arrow in a quoted label nor one in a comment.
 */
function maskZenuml(source: string): string {
  let out = '';
  let inString = false;
  let inComment = false;
  for (const ch of source) {
    if (ch === '\n') {
      inString = false;
      inComment = false;
      out += ch;
    } else if (inComment) {
      out += ' ';
    } else if (inString) {
      if (ch === '"') inString = false;
      out += ch === '"' ? '"' : ' ';
    } else if (ch === '"') {
      inString = true;
      out += ch;
    } else if (ch === '/' && out.endsWith('/')) {
      inComment = true;
      out = `${out.slice(0, -1)}  `;
    } else {
      out += ch;
    }
  }
  return out;
}

function position(text: string, offset: number): { line: number; col: number } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return { line, col: offset - (before.lastIndexOf('\n') + 1) };
}

/** An arrow, a call `B.m(` / `B."x"(`, an assignment from a call, or a return. */
const STATEMENT = /->|[A-Za-z_]\w*\s*\.\s*(?:[A-Za-z_]|")|\breturn\b/;
const GROUP_HEAD = /^[ \t]*(group)\b[ \t]*(?:"[^"\n]*"|[A-Za-z_]\w*)?\s*\{/gm;
const NAME = String.raw`(?:[A-Za-z_]\w*|"[^"\n]*")`;
const ASYNC_MESSAGE = new RegExp(String.raw`^[ \t]*(${NAME})?\s*->\s*(${NAME})\s*:([^\n]*)$`, 'd');

/** Each `A->B: label` line, with its participants as written (quotes kept). */
function asyncMessages(masked: string, original: string) {
  const originalLines = original.split('\n');
  return masked.split('\n').flatMap((text, i) => {
    const m = ASYNC_MESSAGE.exec(text);
    const at = m?.indices;
    if (!m || !at) return [];
    const written = (span?: [number, number]) => (span ? originalLines[i].slice(span[0], span[1]) : '');
    return [{ line: i + 1, label: m[3], labelStart: at[3][0], from: written(at[1]), to: written(at[2]) }];
  });
}

function nestedFix(from: string, to: string): string {
  return `${from}->${to}.method() { … }`;
}

/** Warnings for a ZenUML source that parsed but will not draw what was meant. */
export function lintZenuml(source: string): ZenumlIssue[] {
  const masked = maskZenuml(source);
  const issues: ZenumlIssue[] = [];

  for (const m of masked.matchAll(GROUP_HEAD)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0;
    let close = masked.length;
    for (let i = open; i < masked.length; i++) {
      if (masked[i] === '{') depth++;
      else if (masked[i] === '}' && --depth === 0) {
        close = i;
        break;
      }
    }
    if (!STATEMENT.test(masked.slice(open + 1, close))) continue;
    issues.push({
      code: 'group_with_messages',
      ...position(source, (m.index ?? 0) + m[0].indexOf('group')),
      message:
        'This group holds a message, so the parser ends the group at its name and reads the braces as a separate ' +
        'block, and the group draws empty: put only participant names inside it (`group "Backend" { B C }`) and ' +
        'write the messages after it.',
    });
  }

  for (const msg of asyncMessages(masked, source)) {
    const brace = msg.label.indexOf('{');
    if (brace < 0 || !STATEMENT.test(msg.label.slice(brace + 1))) continue;
    issues.push({
      code: 'block_in_async_message',
      line: msg.line,
      col: msg.labelStart + brace,
      message:
        'The `{ … }` after this async message is read as part of its label, so nothing inside it is drawn: nest ' +
        `the calls with \`${nestedFix(msg.from || 'A', msg.to)}\` instead.`,
    });
  }

  return issues.sort((a, b) => a.line - b.line || a.col - b.col);
}

/** Specific fixes for recognised mistakes in a ZenUML source that did not parse. */
export function zenumlFailureHints(
  source: string,
  errors: ReadonlyArray<{ line: number; col: number; message: string }>,
): ZenumlIssue[] {
  const hints: ZenumlIssue[] = [];
  const groupError = errors.find((e) => /'group'/.test(e.message));
  if (groupError) {
    hints.push({
      code: 'group_after_message',
      line: groupError.line,
      col: groupError.col,
      message:
        '`group` must come before the first message: move this group to the top and keep only participant names in it.',
    });
  }
  for (const msg of asyncMessages(maskZenuml(source), source)) {
    const label = msg.label.trimEnd();
    if (!label.endsWith('{')) continue;
    hints.push({
      code: 'block_after_async_message',
      line: msg.line,
      col: msg.labelStart + label.length - 1,
      message:
        'An async message `A->B: text` cannot open a `{ }` block, and the parser reports the error at the closing ' +
        `brace instead: write \`${nestedFix(msg.from || 'A', msg.to)}\` to nest the calls.`,
    });
  }
  return hints.sort((a, b) => a.line - b.line || a.col - b.col);
}
