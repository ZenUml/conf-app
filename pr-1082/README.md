# PR 1082 evidence

BEFORE: b0565325 (main, the merge of #1073). AFTER: e887c274.

- before-*.jpg/png: lite-stg, Lite staging app, CI-deployed b0565325, test page in the SD space, author Chrome, seeded starter code only.
- after-storybook-saved-mermaid-card.jpg: Storybook dev server at e887c274 (uncommitted a moment earlier, same content), story Editor/Diagram/WorkspaceMcpPromo NewDiagramCardOnSavedTab, fixture data.
- tests-before.txt: the new spec files run against the old useEditorMcpPromo.ts and restoreDraftBanner.ts from b0565325 (8 fail).
- tests-after.txt: same suites plus neighbours at e887c274 (718 pass; the log lists the two touched spec files and the totals).

Limits: Storybook uses the mock agent-link flag and no Forge context. Staging AFTER checks are listed in the PR once done.
