# PR #1339 — Connect MCP button test

Candidate `3a486bb21b7fde4938fd78f18fd8bdd4e7a9d239`; baseline `main` at `f0980039f` (the control arm is the baseline button, unchanged).

All captures are the macro **at rest**: the mouse is outside the macro, so the inline header shows only what is visible without hover.

| File | Where | Arm | Viewer | Observed |
|---|---|---|---|---|
| `whimet4-control.png` | whimet4 dev site, Forge build `3a486bb` (bundle contains the SHA) | `control` (forced) | robot account, can edit | label `MCP`, opacity 0, title "Connect MCP" |
| `whimet4-outcome-editor.png` | same | `outcome_label` (forced) | same | label `Use with AI`, opacity 1, pinned, title "Connect an AI agent (MCP)" |
| `storybook-control.png` | `storybook dev`, story `Connect MCP test — control, at rest` | `control` | can edit | label `MCP`, opacity 0 |
| `storybook-outcome-editor.png` | story `Connect MCP test — "Use with AI", editor at rest` | `outcome_label` | can edit | label `Use with AI`, opacity 1, pinned |
| `storybook-outcome-reader.png` | story `Connect MCP test — "Use with AI", reader at rest` | `outcome_label` | cannot edit | label `Use with AI`, opacity 0 |

- Arms were forced with the QA override `localStorage['zenuml.mcpButtonVariant']` in the macro iframe; production assigns them by account hash.
- Storybook evidence is from the dev server because `storybook build` currently fails on `main` (the `zenuml-core-closure-guard` plugin rejects 9 unrelated stories).
- Viewport 1400×1000 (whimet4) and 900×420 (Storybook), device scale 2. Fixture diagrams only; no customer data.
- `check-btn.cjs` drove whimet4; `probe-storybook.cjs` drove the Storybook stories.
- Not captured: CI-deployed staging (the PR's Lite deploy is skipped until the E2E decision is published).
