# lite-stg on main 4749902e (merge of PR 1272, Vite 8 / Rolldown)

Main "Staging validation" run 45147278958 deployed Lite at 09:31:39Z; main had not moved since. Robot account,
agent-browser, the (archived, still viewable) throwaway page with fixture diagrams.

- `deployed-assets-verdict.txt`: the macro iframe's deploy serves `Workspace` 663,942 B, no `--tw-*` reset, and a
  1,404 B `zenuml-definition` importing `zenuml.esm-CHL7oCR6.js`: the deduped Rolldown build (same sizes and chunk
  hash as the whimet4 deploy of 77ef1699 and the local build).
- `mermaid-zenuml-viewer.png`: Mermaid `zenuml` macro with VPC and RDS icons, IBM Plex, under the Forge CSP.
- `editor-lint.png`, `editor-lint-zoom.png`: ZenUML editor after deleting `)` in `login(user)`: error bar
  "line 4, column 22: missing ')' for the '(' of this call", squiggle under `u`. Nothing published.
