# Approved full PR E2E results

Head0ce0578c, synthetic candidate308542f9, tested tree21212a4af895a9544415d385e69deceaff3414aa. Runtime unchanged from UI evidence a87551e9; last commit changes IMPACT-MAP.md only.

[Manual full approval](https://github.com/ZenUml/conf-app/pull/1192#issuecomment-6902895245).
[Parent validation](https://github.com/ZenUml/conf-app/actions/runs/43772919155): all7 jobs passed, including Pipeline outcome.
[Full E2E child](https://github.com/ZenUml/conf-app/actions/runs/43773318017): all10 Lite shards, render shard, and both evidence aggregates passed.

| Scope | Planned/executed | Passed | Skipped | Failed | Complete coverage flag |
|---|---:|---:|---:|---:|---|
| Lite regression |109|101|8|0|false|
| Render |19|19|0|0|true|
| Total |128|120|8|0|not all cases executed|

The8 explicit suite guards require PAGE_ID(2), AGENT_LINK_RELAY=1(3), RUN_REGRESSION=true(2), or REPRO_PAGE_ID(1). They are not reported as passes. Evidence validation is valid and execution_succeeded=true for both groups. These guards do not skip any new per-space-purchase assertion; those cases are covered separately by unit and ordered manual UI checks.

One same-page duplicate Edit-gate test(fullscreen/writeback-gate-non-submittable.spec.ts:94) passed on retry1 after Edit remained enabled for the first attempt’s15s assertion timeout. This is a possible flaky UI test, not a proved infrastructure failure or a proved fixed product bug. The PR does not change its copy-scan/Edit gate code. No workflow reruns or code fixes were made to obtain the result.

No production release or payment was performed.
