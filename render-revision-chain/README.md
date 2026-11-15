# Render MCP revision chain evidence

- BEFORE: `a3e69c19` (PR #1189 head). AFTER: `571d85d3` (`feat/render-mcp-revision-token`).
- Probe: `chain.spec.ts`, copied into `functions/agent-link/` and run with
  `CAPTURE_OUT=<file> pnpm exec vitest run functions/agent-link/chain.spec.ts`. Three
  `render_diagram` calls through `handleRenderRequest`, no network, fictional source:
  1. `first`: `group` after the first message, holding a message. No revision.
  2. `repeat`: the same source again, with `first`'s revision.
  3. `applied`: `first`'s `suggestedSource`, with `repeat`'s revision.
- `chain.json`: the text the agent reads and `structuredContent` without `source`.

| Call | attempt | nextActions | text lead |
|---|---|---|---|
| first | 1 | apply_suggested_source, confirm_with_user | parse errors + rewrite |
| repeat | 2 | same | "Same mistake as the previous attempt (group_after_message), now attempt 2: use the rewrite below…" |
| applied | 3 | offer_to_save | "Rendered the sequence diagram. The source parsed." |

At BEFORE none of attempt, nextActions or revision exist; each call reads alone.
