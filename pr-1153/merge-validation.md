# PR #1153 merge validation

PR head: `6a386f18fa30aa8b36b0e2f2069e94c7aed2224e`. Target: `46480f305e88f84755c79c9f28edc283c570481d`. Tested synthetic merge: `718deb86b29fd95b5dbd19b8163020b13ad755de`. Actual merge: `7143f5efe24b3976fec21d2933ec48587026aff9` (2026-11-13 09:08:11 UTC). Both merge commits have tree `751f6e95366363695b92a82e6c6f305b4fdd6154`. Application source under src/functions/public/vendor matches the earlier UI-tested `7dc2c46c`; intervening changes integrate trusted CI controller updates and retain IMPACT-MAP.md triage boundaries.

User explicitly authorized manual pr-triage and skipped the merge quiz. Current full decision: https://github.com/ZenUml/conf-app/pull/1153#issuecomment-6848170608. Ready, executable decision, no requested changes/conflicts, no child PR and all current GitHub checks were verified before merge. No automatic full fallback or test gate bypass was used.

## Actual results

- Unit/build: four shards, AsyncAPI build/CI script tests and build-result job passed on head. The initial same-head run had a stale-authorization failure, superseded by the authorized runs below.
- Viewer preview: Mermaid runtime22/22, preview6, Mixpanel isolation1 passed: https://github.com/ZenUml/conf-app/actions/runs/43394932268
- Standalone Export:85 passed: https://github.com/ZenUml/conf-app/actions/runs/43394932154
- PR parent, including Pipeline outcome, SUCCESS: https://github.com/ZenUml/conf-app/actions/runs/43394932273
- Actual child,10 Lite shards,render1/1,both evidence aggregates SUCCESS: https://github.com/ZenUml/conf-app/actions/runs/43397001395
- Concrete Lite results:111 planned,102 passed,9 skipped,0 failed; one passing result needed retry1. Artifact complete=false because skipped assertions are not passes. See pr-e2e-lite.json.
- Render:19 planned/passed,0 skipped/failed,complete=true. See pr-e2e-render.json.

## Nine skipped assertions

Runtime blob annotations were checked against source guards:

| Cases | Reason | Coverage limit |
|---|---|---|
|3 legacy agent relay cases|AGENT_LINK_RELAY not enabled; relay not offered in headless-only release|Retired relay behavior not tested|
|2 nested orchestration cases|RUN_REGRESSION unset; would shell out to other suites|No extra nested suite execution|
|1 draft-only PhaseB|REPRO_PAGE_ID unset|Manual cross-deploy fixture not exercised|
|1 Copy for AI|Connect MCP replaces the button on this test site|Copy-for-AI positive assertion not exercised|
|2 CSAT existing-page cases|PAGE_ID unset|Applicable assertions unverified because required fixture is absent|

None are title-draft recovery assertions. The absence of a title-draft-specific E2E pair remains explicit in IMPACT-MAP.md; the direct component and UI evidence are separate. OAuth integration and child auth/report-merging jobs skipped according to the configured plan; not counted as passed.

## Post-merge

Main pipeline: https://github.com/ZenUml/conf-app/actions/runs/43398790361
Status: SUCCESS on merge7143f5ef, including Pipeline outcome. Build child43400529075 and staging child43400526313 succeeded. Actual main E2E children: Lite43401212393 (7/7 shards), Full43401248614 (7/7), Diagramly43401245334 (7/7), AsyncAPI43401212555 (2/2), all succeeded. These are main's configured plans, separate from the full PR plan above. Draft child43401866472 and its four Draft jobs succeeded. Four draft releases v2026.11.131920-{lite,full,diagramly,asyncapi} were read back from GitHub with draft=true and target_commitish=7143f5efe24b3976fec21d2933ec48587026aff9. No production app release was published.
