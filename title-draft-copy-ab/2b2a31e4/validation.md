# Title-draft copy A/B validation

Candidate: codex/title-draft-copy-ab, commit2b2a31e4.

Storybook: PASS. Both representative native-flag fixtures use the production copy constants. Exact A/B title, description and action labels were observed, with desktop screenshots alongside this report. Storybook represents the flag; it does not claim to render Confluence chrome.

Forge Tunnel: PASS after Storybook. The actual Forge-account identity was verified in the daily Chrome profile. The banner and preview iframe used localhost:8000; source scripts included @vite/client and src/forgeIndex.ts. The local Vite build and received analytics identify2b2a31e4.

Actual native flag AX excerpt:
- heading A diagram for this page is ready
- text ZenUML sketched it from the page title. Nothing changes until you add it.
- button See diagram
- button Not now

Clicking See diagram opened the real native preview; an actual Mermaid flowchart rendered with an enabled Add to page button. The host close button dismissed it without changing page content.

Received Mixpanel events all shared experiment title-draft-offer-copy, version1, variantA and the same exposure ID: flag_shown, preview_opened, preview_mounted, preview_rendered, preview_closed. Close reason: host_dismissed. Another development-page exposure for the same account also assignedA with a different exposure ID.

Method: reused an internal ready draft and cleared only this owned development account's entry-flag cooldown to repeat the fixture. No generation/provider change and no Add/save action. Actual native B is reserved for staging with a different fixed account assignment; B's exact copy and integration are already covered by Storybook and unit tests.

Local checks: lint0 errors/140 existing warnings; Lite build pass;134 focused tests pass. Full suite6628 passed,3 failed to load standalone E2E dependencies,3 skipped; after installing the E2E subproject dependencies all4 tests in the affected file passed. Independent Spec and Standards reviews reported no actionable findings.

Mixpanel board: https://mixpanel.com/project/3373228/app/boards#id=11643360

CI staging and E2E will be recorded in the PR after deployment. This document does not claim production launch.
