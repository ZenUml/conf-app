# Post-merge main CI

Merge6ecceaedc641515b070e1dee6afe27b42302fd04, tree21212a4af895a9544415d385e69deceaff3414aa (same as the PR E2E tested tree).

[Main pipeline43774744430](https://github.com/ZenUml/conf-app/actions/runs/43774744430): completed success for exact merge SHA.
[Build preparation43774778471](https://github.com/ZenUml/conf-app/actions/runs/43774778471): all four variant builds, unit tests, viewer preview and Cron deployment passed.
[Staging wrapper43774778483](https://github.com/ZenUml/conf-app/actions/runs/43774778483): all19 jobs passed, including four variant deployments/authentication/E2E validation.
[Render MCP43774744474](https://github.com/ZenUml/conf-app/actions/runs/43774744474): success.
[Draft releases43775579230](https://github.com/ZenUml/conf-app/actions/runs/43775579230): all7 jobs passed.

Main selected E2E (distinct from the earlier full PR inventory):

| Variant | Passed | Guard-skipped | Failed | Retried |
|---|---:|---:|---:|---:|
| Full |7|0|0|0|
| Diagramly |6|1|0|0|
| Lite |7|0|0|0|
| AsyncAPI |2|0|0|0|
| Total |22|1|0|0|

Diagramly skip: Embed deeplink auto-convert test requires an Embed macro absent from that app profile (explicit guard at embed-deeplink-autoconvert.spec.ts:22). This is not counted as a pass.

Four draft releases v2026.11.160925-{lite,full,diagramly,asyncapi} all target the exact merge SHA, verified through the GitHub releases API. They remain drafts; no production release was started. No workflow rerun or post-merge source fix was needed.

Earlier approved full PR E2E remains120 passed,8 guarded skips,0 failures with one UI assertion passing on retry1; see full-e2e-results.md for that separate result and its limits.
