# PR 1082 evidence

BEFORE: b0565325 (main, the merge of #1073). AFTER: e887c274.

- before-*.jpg/png: lite-stg, Lite staging app, CI-deployed b0565325, test page in the SD space, author Chrome, seeded starter code only.
- after-storybook-saved-mermaid-card.jpg: Storybook dev server at e887c274 (uncommitted a moment earlier, same content), story Editor/Diagram/WorkspaceMcpPromo NewDiagramCardOnSavedTab, fixture data.
- tests-before.txt: the new spec files run against the old useEditorMcpPromo.ts and restoreDraftBanner.ts from b0565325 (8 fail).
- tests-after.txt: same suites plus neighbours at e887c274 (718 pass; the log lists the two touched spec files and the totals).

Limits: Storybook uses the mock agent-link flag and no Forge context. Staging AFTER checks are below.

## Staging, e887c274

Deployed by PR validation run 42351500951 (workflow_dispatch, pr-number=1082), Lite deploy finished 2026-11-07T07:33:16Z. The served bundle was fetched from the macro iframe URL and contains draft-banner-visibility, a string this PR adds. Site lite-stg, test page in the SD space, author Chrome. Nothing was published.

Observed: card on a new macro with Mermaid saved; card stays when switching tabs; gallery and AI chat hide it and it returns; an edit hides it; tip held while the banner is up and appears with a reachable button after Not now; tip prompt carries cloudId, pageId and contentId.

One run differed: in 1 of 3 saved-macro loads the tip never appeared, and the AI Chat button was also missing for that whole load. The cause was not established; a failed feature-flag lookup is a guess. The same sequence passed on the repeat.

Not checked on staging: the auto-opened gallery (markers already set in this browser), impressions and session counts (Forge iframe storage cannot be read with this browser tool).
