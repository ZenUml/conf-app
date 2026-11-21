# Staging (lite-stg), PR 1272 head 5f584c73

Page: throwaway spot-check page on lite-stg (fixture diagrams only). Robot account, agent-browser.

## Which build was served
`deployed-assets-verdict.txt` (18:43Z): the macro iframe's Forge deploy `065f0ce7…` served
`Workspace` = 662,047 bytes with no `--tw-*` reset, and `zenuml-definition` = 1.5 KB importing the
shared `zenuml.esm` chunk. `local-build-reference.txt`: a local `PRODUCT_TYPE=lite` build of
5f584c73 gives the same `Workspace` size, 662,047 bytes. Main (and every other open branch checked)
still pins `@zenuml/codemirror-extensions ^0.3.1` with no override; its lite `Workspace` is 2,421,115
bytes with the reset. `stg-check.sh` is the script that produced the verdict.

## Screenshots (taken 18:43Z to ~18:58Z, before deploy `d99bdbe5` replaced it at 19:01Z)
- `stg-after-mermaid.png`, `stg-after-page-tall.png`: Mermaid `zenuml` macro draws the VPC and RDS
  icons and uses IBM Plex under the Forge CSP; the sequence macro renders normally.
- `stg-after-editor-zenuml.png`: ZenUML editor, normal styling.
- `stg-after-editor-lint.png`, `-zoom.png`: after deleting `)` in `login(user)`, the error box reads
  "line 4, column 22: missing ')' for the '(' of this call" and the lint squiggle sits under `u`
  (4.13.1 parser; main's 3.43.3 linter marks `{`). Self-identifies the build.
- `stg-after-editor-mermaid-typed.png`, `stg-after-editor-plantuml.png`: Mermaid and PlantUML
  editors with live previews, normal styling.
Nothing was published (the editor was closed; page version unchanged).

Graph and OpenAPI editors: not loaded through `Workspace` (`forgeIndex.ts` imports
`forge-graph-editor` / `forge-swagger-editor`); their chunks are the same size before and after
(27,763 B and 2,828,011 B) and never contained the reset. No visual check needed or done.
