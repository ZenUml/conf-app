# PR #1189 evidence: render_diagram ZenUML lint

- BEFORE: `19303757` (previous PR head, cheat sheet only). AFTER: `f4a989f2`.
- Probe: `capture.spec.ts`, copied into `functions/agent-link/` and run with
  `CAPTURE_OUT=<file> pnpm exec vitest run functions/agent-link/capture.spec.ts`.
  It sends one `tools/call render_diagram` (diagramType `sequence`) per case through
  `handleRenderRequest` and records the text the agent reads and `structuredContent`
  without `source`. No network; fictional sources.
- `before.json` / `after.json`: the outputs for the same four sources.

| Case | BEFORE | AFTER |
|---|---|---|
| a. message inside `group` (parses) | "The source parsed." | warning `group_with_messages`, line 1 col 0 |
| b. one-line `A->B: text { B->C: … }` (parses) | "The source parsed." | warning `block_in_async_message`, line 1 col 19 |
| c. `group` after first message (fails) | parser error + cheat sheet | hint `group_after_message` line 2 col 0 first, then error + cheat sheet |
| d. multi-line block after async message (fails) | error at line 3 `}` + cheat sheet | hint `block_after_async_message` at line 1 col 14 first, then error + cheat sheet |

Parser facts behind (a), from `@zenuml/core/parser` `parse()`: `group "x" { B C }`
consumes the braces as its participant list; `group "x" { A->B: m }` ends the group
at `group"x"` and parses `{ A->B: m }` as a separate block. Whether that block draws
its message was not checked in a renderer; the warning only claims the group draws empty.
