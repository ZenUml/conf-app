# Dev site (Lite, Forge env "yanhui"), PR 1272 head 77ef1699 (Vite 8 / Rolldown)

Deployed by the "Deploy branch to whimet4 (dev)" workflow, run 45076122723 (success). Throwaway page, fixture
diagram only. Checked in a real Chrome session.

`deployed-assets-verdict.txt`: the macro iframe's deploy serves `Workspace` = 663,942 B with no `--tw-*` reset
(identical size to a local Rolldown lite build of 77ef1699) and a 1,404 B `zenuml-definition` that imports
`zenuml.esm-CHL7oCR6.js`, the same hashed chunk the local build emits.

- `mermaid-zenuml-viewer.png`: Mermaid `zenuml` macro in view mode: Actor, VPC, Lambda, RDS icons; IBM Plex.
- `editor-mermaid-zenuml.jpg`: same diagram in the Mermaid editor's live preview.
- `editor-sequence-error.jpg`, `editor-sequence-lint-zoom.png`: Sequence tab with `@VPC`/`@RDS` participants
  rendered; a stray `}` (bracket auto-close) gives "line 8, column 0: mismatched input '}'" and the lint
  squiggle under it.
- `editor-sequence-fixed.jpg`: brace removed, error bar and squiggle gone.
- `editor-plantuml.jpg`: PlantUML tab, normal styling.
Nothing was published.
