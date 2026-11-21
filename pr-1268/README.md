# PR 1268 evidence

Baseline: `7b7158312^1` (pre-#1260 parser). Candidate: `355d561d7`.

- `staging-zenuml-block-rendered.png`: lite-stg (staging), Mermaid test diagram "Test Mermaid Lite" after `update_diagram` via the `zenuml-stg` MCP replaced its source with a `zenuml` block (v2). The macro renders it as ZenUML. The "upgrade required" watermark is the Lite staging space license overlay, unrelated. Source was restored to the original `sequenceDiagram` afterwards (v3).
- Unit output (before/after) is in the PR description.
