# PR #1344 — AsyncAPI macro on Full, hands-on check on whimet4

- Candidate: `d66ba9eb7` (PR #1344 head), built as **Full** and deployed by
  [deploy-whimet4 run 95](https://github.com/ZenUml/conf-app/actions/runs/46112129972)
  to the Full app's `yanhui` development environment, installed on `whimet4.atlassian.net`
  (Full `yanhui`, version 2). Backend: `conf-stg-full.zenuml.com`.
- Test page: created through the REST API (`create-test-page` skill) with one Full AsyncAPI
  macro (small AsyncAPI 3.0 spec, title "PR1344 Full AsyncAPI check") and one Full sequence macro.
- Browser: Playwright Chromium, 1400 px wide, logged in as the robot test account. 2026-11-28.

| # | Step | Observed |
|---|---|---|
| 01 | Open the page | AsyncAPI macro renders the spec (title, RECEIVE operation, message); sequence macro renders |
| 02 | Click Edit on the AsyncAPI macro | AsyncAPI Studio opens in the Full macro dialog, spec loaded, status VALID, no diagnostics |
| 03 | Append " saved" to `info.title` in Studio, Publish | Custom content went from version 1 to 2 (REST read-back: type `ac:com.zenuml.confluence-addon:zenuml-content-sequence`, `diagramType: AsyncAPI`, new title); page shows the new title |
| 04 | Open the Full "Diagrams" byline | Lists the diagram as AsyncAPI; "Add a diagram" offers an AsyncAPI tile |

## Insert from the Confluence editor (new page)

New page under the test parent, `/` → View more → Browse, search `asyncapi`. Browse listed four options:
AsyncAPI app (`AsyncAPI for Confluence`), **Full** (`ZenUML for Confluence`), Lite (`ZenUML for Confluence Lite`),
and the AsyncAPI app's Embed macro. The Full one was picked by its description, then Insert.

| # | Step | Observed |
|---|---|---|
| 05 | Insert | AsyncAPI Studio opens with the default example spec, VALID |
| 06 | Publish in the macro dialog | Macro renders the example spec inside the page editor |
| 07 | Publish the page | Page view renders the macro. REST read-back: extension key `d9e4002b-…/a0067a64-…/static/zenuml-asyncapi-macro` (Full app, `yanhui` env); custom content `ac:com.zenuml.confluence-addon:zenuml-content-sequence`, version 1, container = the new page, `diagramType: AsyncAPI` |

Not covered: Storybook; CI-deployed
full-stg. A development environment is not the CI-deployed staging stage.
