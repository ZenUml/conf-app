# PR 1272: one @zenuml/core instead of three

BEFORE: `892720329` (main). AFTER: `75ee86c87` (perf/dedupe-zenuml-core).

## Bundle measurements

`PRODUCT_TYPE=full vite build --mode production --sourcemap true`, measured with
`measure.mjs` (source-map byte attribution to each `@zenuml/core` version; static
import closure per entry chunk, excluding chunks already in the entry closure).
Raw files: `bundle-before.json`, `bundle-after.json`.

## Storybook (lite)

Story `Viewer/ZenumlCoreDedupe` (src/components/ZenumlCoreDedupe.stories.ts),
copied into the baseline checkout for BEFORE. Fixture data only. Built-in browser, 800x600.

- `sb-mermaid-zenuml-icons-BEFORE.jpg` / `sb-mermaid-zenuml-icons.jpg`: Mermaid `zenuml`
  diagram with `@Actor`, `@VPC`, `@Lambda`, `@RDS`.
- `sb-lint-error.jpg`: broken ZenUML code; DOM shows 1 `.cm-lintRange-error`.
- `sb-lint-valid.jpg`: valid code; 0 `.cm-lintRange-error`.

## Limits

Forge Tunnel and staging UI checks not done (see PR description).

## Update for final head `000893b1`

- `sb-mermaid-zenuml-icons-000893b1.jpg`: same story rerun on `000893b1`; lint stories again 1 mark (broken) / 0 marks (valid).
- `guard-proof.log`, `guard-failure-messages.txt`: `PRODUCT_TYPE=<v> vite build --mode production` for full, lite and asyncapi
  (asyncapi without the studio submodule build), first with the vite.config.mjs zenuml-linter treeshake rule,
  then with it replaced by `moduleSideEffects: true`. With the rule: rc=0. Without: rc=1, guard names the Workspace chunk.
- `stg-before.png`: lite-stg throwaway page on the main build before this PR deployed (Mermaid zenuml lacks VPC/RDS icons).
- `bundle-after.json`: re-measured on the final code (unchanged within ~100 bytes).
