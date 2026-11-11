# Title-draft copy A/B validation

PR: https://github.com/ZenUml/conf-app/pull/1110
Head: 2b2a31e4de2398950cdfdba0a14849a648ce0333

## Ordered UI validation

1. Storybook PASS on candidate 2b2a31e4. Exact A and B headline, description and buttons observed. The fixture shares production copy constants and represents native flag content; it does not claim to render host chrome. Screenshots are alongside this report.
2. Forge Tunnel PASS after Storybook. Actual authenticated account and local Vite source verified. Banner and preview iframe were served by localhost:8000 with @vite/client and src/forgeIndex.ts. Received analytics identified candidate 2b2a31e4. Actual native A flag was clicked and the Mermaid preview rendered; host close did not change page content. Five received lifecycle events shared A and the same exposure ID. A second owned development-page exposure assigned A again with a new ID.
3. CI Staging UI and experiment attribution PASS after Deploy Lite job130455358786 succeeded. Source identity 46c90b958aeaf13c3a04481186f96ff375587b72 is the CI merge of candidate 2b2a31e4 into base d2553d9e. Visible debug label and CDN __ci-version.json both matched it; actual iframe host was Atlassian CDN, with no tunnel.

Native B flag observed:
- Help readers understand this page
- Preview a draft diagram based on the page title. Your page stays unchanged until you add it.
- Preview diagram / Not now

The actual action opened a rendered Mermaid preview with enabled Add to page. Clicking Add succeeded and inserted the diagram at the top of the internal fixture. After reload, native Undo restored the exact original ADF body and title (page versions3 ->4 ->5). Received flag_shown, preview_opened, preview_mounted, preview_rendered, add_clicked, added and undone all retained version1, variantB and exposure e06efe1a-b6be-4615-8fe2-d11d4f493758.

A second ready internal page assigned B again with a new exposure f2a9757c-2df8-4a57-a7a3-0b6927a34b17. Its preview rendered and native host close yielded preview_closed with host_dismissed and the same exposure. Only this owned staging account's entry-flag cooldown was cleared to repeat the fixture; no customer state was touched and no AI generation was needed.

### Separate cleanup finding

The native Undo restored the page, but its best-effort custom-content DELETE returned401 and left an unreferenced test record. This cleanup assertion FAILED. The implementation in undo.ts and manifest permissions are byte-identical to the prior production release; the A/B change does not modify this path. Admin API cleanup then returned204 and readback confirmed status trashed. Do not describe the native record cleanup as passed. Successful page restoration and the new experiment attribution were independently observed.

## Automated validation

- Authoritative PR run https://github.com/ZenUml/conf-app/actions/runs/42995962551 SUCCESS on exact head2b2a31e4.
- Actual E2E child https://github.com/ZenUml/conf-app/actions/runs/43001105419 SUCCESS: Lite1/10 through10/10 and render1/1, all11 actual shards and both evidence aggregates passed.
- Independent PR build/unit/viewer, export and render checks succeeded.
- Local134 focused tests passed, lint0 errors/140 existing warnings, Lite build passed. Full unit run6628 passed with three standalone E2E dependency-load failures; after dependency install all four tests in that affected file passed. Three intentional skips.
- Independent Spec and Standards reviews: no actionable findings.

## Mixpanel

Board: https://mixpanel.com/project/3373228/app/boards#id=11643360

Five saved reports cover enrollment,24h preview conversion, full Add funnel, daily exposure and diagnostics. Two funnels use unique accounts,24h windows, explicit qualifying-event filters at every step, title_draft_exposure_id held constant, and optimized reentry off. Saved UI state was reopened and verified; both reports also execute via connector. Final analysis requires the full experiment date range and24h-matured users. No daily significance stopping or automatic winner.

## Release status

RUNNING. PR1110 merged at9ed2baf7cf727c88b9fd104b9a7d99c98e0b3546 and both authorized production variants have passed their release validation.

Staging replay verification: Mixpanel returned recorded replay a135f746-5719-4605-8101-d5f080955e78, joining B add_clicked and added to the same exposure, followed by macro_viewed. This is an internal positive control, not customer adoption. All five reports and the board now use Since Nov11,2026 with a dynamic end date.

## Completed main and production validation

- Main root43003119027 SUCCESS, with successful source9ed2baf7 build43009705604, staging43009710361, and draft43011040317. Lite/Diagramly deploy, validation and draft jobs all passed. The workflow-dispatch API head belongs to the workflow controller; explicit source/producer provenance pins the application to9ed2baf7.
- Merged-source Staging UI PASS: visible debug identity and CDN identity matched9ed2baf7; exact native B, rendered preview and host close were observed. Five received lifecycle events retained one B exposure. Actual preview replay was retrieved. No Add/save in this repeat. Screenshots and main-staging-result.json are alongside this report.
- Diagramly v2026.11.112109-diagramly: prerequisite OK; published first; production deployment succeeded11:31:45 UTC. Release43012310176 SUCCESS and all5 actual production smoke shards PASS. Visible Diagramly debug identity matched9ed2baf7; existing sequence diagram rendered from the real CDN. New title-draft behavior is not testable through Diagramly normal UI because of the Lite-only offer guard.
- Lite v2026.11.112109-lite: select-draft and prerequisite matched the published Diagramly commit exactly. Production deployment succeeded2026-11-11T11:38:39Z (22:38:39 Melbourne). Release43013279865 SUCCESS and all5 actual smoke shards PASS, last finishing11:40:45 UTC.
- Lite focused checks PASS: visible debug identity9ed2baf7 and real CDN iframe; exact approved B flag; native Preview action; actual rendered preview with enabled Add button; native host close. Five received events retained one exposure and version1/variantB, with host_dismissed close reason and app_version v2026.11.112109-lite. A replay was retrieved and joined to preview_rendered at100% preview recording.
- Production method/limit: internal controlled probe invoked the existing exported offer helper while another page banner was present. No cooldown existed to clear. The native action/modal and account/page eligibility checks were real; this is separate from naturally arriving customer events. No production Add/save was attempted. Actual successful title-draft Add/Undo attribution was tested on Staging; normal create/edit remains covered by regression and production smoke.
- Board11643360 is RUNNING. All5 saved reports execute, fixed since2026-11-11, and both customer cohorts now appear in the live reports. Core funnel uses per-step qualifying filters, unique accounts,24h, constant exposure ID and optimized reentry off. Internal test traffic is excluded.

Customer snapshot received at2026-11-11T11:49:54.389433+00:00: A7, B2 unique exposed accounts across8 sites; cross-group accounts0. No24h outcomes have matured. These are early SDK flag-event counts, not proof every user saw/read a flag and not an A/B comparison result. No real customer names, site IDs or account IDs are included in this evidence.

The existing one-time24h follow-up retains its original schedule and destination; its prompt now records this A/B deployment and the SDK-event visibility limit. The prior native Undo record-cleanup401 finding remains separate and is not claimed to have passed; its owned test record was administratively trashed.
