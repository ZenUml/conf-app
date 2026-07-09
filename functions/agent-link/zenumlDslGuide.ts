// ZenUML DSL guidance surfaced to the connected agent so ANY MCP client
// (Claude Code, Cursor, …) writes valid ZenUML sequence syntax on the first
// try, instead of guessing Mermaid/PlantUML-style control flow and getting a
// `rendered: false` retry loop. Delivered three ways (mcp.ts): the
// `initialize` result's `instructions` (auto-surfaced by clients), the
// `zenuml://dsl-guide` resource (resources/read), and a summary appended to
// the `update_diagram` tool description (mcpTools.ts).
//
// Syntax below is transcribed from the ZenUML grammar
// (mmd-zenuml-core/src/g4/sequenceParser.g4 + sequenceLexer.g4), not memory:
//   alt : ifBlock elseIfBlock* elseBlock?   ifBlock: IF parExpr braceBlock
//   loop: WHILE parExpr? braceBlock  (WHILE = while|for|foreach|forEach|loop)
//   par: PAR parExpr? braceBlock     opt: OPT parExpr? braceBlock
//   critical: CRITICAL parExpr? braceBlock   section: SECTION (OPAR atom CPAR)? braceBlock  (SECTION = section|frame)
//   tcf: tryBlock catchBlock* finallyBlock?  catchBlock: CATCH invocation? braceBlock
//   creation: (assignment? NEW construct (OPAR parameters CPAR)?) ...
//   asyncMessage: (from ARROW)? to COL content   (ARROW '->')

/** Full ZenUML DSL reference — used for `initialize.instructions` + the resource. */
export const ZENUML_DSL_GUIDE = `# Writing ZenUML sequence DSL for update_diagram

When this session's diagram type is "sequence", the \`dsl\` passed to
update_diagram must be **ZenUML** DSL (NOT Mermaid/PlantUML). Read the current
diagram with read_diagram first, then send the FULL replacement DSL.

## Messages
- \`A.method(args)\`        sync call to A (auto activation + return)
- \`A->B.method(args)\`     sync call from A to B
- \`A->B: message\`         plain message from A to B
- \`x = A.method()\`        capture the returned value
- \`return value\`          return, inside a method's { } block
- \`new B()\` / \`b = new B()\`   object creation

## Control flow (parentheses on conditions; braces around the body)
\`\`\`
if (condition) {
  A.doThis()
} else if (condition) {
  A.doThat()
} else {
  A.fallback()
}

while (condition) { A.retry() }      // for / forEach / loop are synonyms
opt (condition) { A.maybe() }        // optional fragment
par { A.first()  B.second() }        // parallel
critical { A.locked() }              // critical region
section(label) { A.step() }          // labeled frame (frame(label){ } also works)
try { A.risky() } catch (e) { A.handle() } finally { A.cleanup() }
\`\`\`

## Notes
- Nest calls inside a caller block: \`A.method() { B.other() }\`
- Comments: \`// like this\`
- Participants are inferred from names; optionally declare with annotators
  (\`@Actor User\`, \`@Database DB\`) or alias (\`Long Name as X\`).
- Keep control-flow conditions SHORT — a few words inside the parens, e.g.
  \`if (all checks pass) { }\`. A long predicate overflows the parser and spills
  the rest of the line out as stray messages; put the full predicate in a
  \`//\` comment on the line above instead.
- \`rendered:true\` from update_diagram only means the DSL PARSED, not that it
  says what you meant. For a structurally complex diagram, read it back and
  confirm the fragments nested the way you intended.
- If the diagram type is "mermaid" or "plantuml", ignore all of the above and
  use standard Mermaid / PlantUML sequence syntax instead.`;

/** One-liner appended to the update_diagram tool description (kept short). */
export const ZENUML_DSL_TOOL_HINT =
  'For "sequence" diagrams the DSL is ZenUML: `A.method()` / `A->B: msg`, ' +
  'and control flow `if(c){}else if(c){}else{}`, `while(c){}`, `opt(c){}`, ' +
  '`par{}`, `critical{}`, `section(label){}`, `try{}catch(e){}finally{}`. ' +
  'See the server instructions or the `zenuml://dsl-guide` resource for the ' +
  'full reference. For "mermaid"/"plantuml", use their standard syntax.';

/** URI of the guide exposed via resources/list + resources/read. */
export const ZENUML_DSL_GUIDE_URI = 'zenuml://dsl-guide';
