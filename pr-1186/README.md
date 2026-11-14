# PR #1186 evidence: layout rules in the Mermaid guide

- BEFORE: `96270732` (merge-base with `main`)
- AFTER: `4a9082a4` (head of `feat/mcp-mermaid-layout-guide`)

## What changed

Text only: a "Layout" section in `MERMAID_DSL_GUIDE` (`functions/agent-link/mermaidDslGuide.ts`) and its generated mirror `functions/agent-link/guides/mermaid.md`. Full diff: `guide.diff`. It distils the layout preferences of `.claude/skills/diagram-refinement/references/quality.md` and applies only to new diagrams or explicit layout requests; it is placed after the minimal-edit contract, which still governs every repair.

## The measured example in the guide

Both images: the MCP Apps view (build of `feat/mcp-view-zoom` at `4a2cdff5`, same view as production after #1181) in the fake host from #1177, 640px card, viewport 1000x700. The diagram is fictional.

| | Source | Natural size | Drawn at |
|---|---|---|---|
| `before-lr-640.jpg` | 12 nodes as one `flowchart LR` row | 1706 x 222 | 37% |
| `after-guided-td-640.jpg` | Same 12 nodes and 12 edges, laid out per the new rules (`flowchart TD`, tighter spacing, one `failure` class) | 379 x 940 | 100% |

The refined source was also checked against production `render_diagram`: `valid: true`.

The 2-row variant (`flowchart TB` with two `direction LR` subgraphs) measured 556 x 1202: Mermaid ignored the subgraph directions because Payment links into the other group. That is the basis of rule 3.

## Limits

- No agent was run with the new guide. Whether agents follow it, and whether it moves the offline eval (`guides/mermaid.md` is the file Track E1 reads), is not measured.
- The minimal-edit contract is unchanged; the eval's repair cases should not be affected, but that is not re-measured either.

`unit.txt`: `functions/agent-link/` at AFTER, 843 passed, 3 skipped.
