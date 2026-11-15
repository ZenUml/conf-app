# PR #1188 evidence — per-site paywall enforcement, watermark slice

- BEFORE (base): `2ae6cbb7` (`main`)
- AFTER (candidate): `d965fb92` (`feat/per-site-paywall-enforcement`)
- Captured 2026-11-15 (AEDT) with agent-browser 0.35.0 against local Storybook, viewport 1280 wide.
- Fixture data only. "Login flow", the space key `DOCS` and the counts 2,282 / 150 / 48,203 are invented.

## How the screenshots were made

1. `PRODUCT_TYPE=lite pnpm exec storybook dev -p 6117 --no-open --ci` (Lite build).
2. Open `iframe.html?id=<story id>&viewMode=story`, wait for the viewer, screenshot.
3. The stories mount the real `GenericViewer`. Only the bridge transport is stubbed: `/api/space-status` returns the `enforcement` object shown in `LicenseNotice.stories.ts`.
4. `full-notice-on-unchanged.png` comes from a second Storybook started with `PRODUCT_TYPE=full` on port 6118, story `viewer-licensenotice--notice-on`.

| File | Story | Stubbed `enforcement` | Observed |
|---|---|---|---|
| `viewer-licensenotice--lite-limit-reached-2282.png` | `viewer-licensenotice--lite-limit-reached-2282` | stage `watermark`, count 2282, `effects.watermark = true` | watermark in three lines of one width, `UPGRADE REQUIRED` / `2,282 of 100 Lite diagrams in this space` / `Ask your Confluence admin to upgrade`, wholly above the strip; strip "Lite diagram limit reached" |
| `viewer-licensenotice--lite-limit-reached-at-threshold-150.png` | `…--lite-limit-reached-at-threshold-150` | stage `watermark`, count 150 (the enforcement threshold) | same notice with `150 of 100` |
| `viewer-licensewatermark--lite-count-48203.png` | `viewer-licensewatermark--lite-count-48203` | component only, five-digit count | all three lines measure 752 units wide (count line 40.3, action line 43.2, headline 74); rotated block spans y 12–406 of the 430-unit area |
| `viewer-licensenotice--lite-notice-stage-no-watermark.png` | `…--lite-notice-stage-no-watermark` | stage `notice`, `effects.watermark = false` | diagram only, no watermark, no strip |
| `full-notice-on-unchanged.png` | `viewer-licensenotice--notice-on` (Full build), at `efe1ea5e` | n/a | Full notice before the position fix: second line partly under the strip |
| `full-notice-on-watermark-clear-of-strip.png` | same story (Full build, port 6017), at `d965fb92` | n/a | Full text and sizes unchanged (`NO ACTIVE LICENSE`, 96 / 30); watermark now over the diagram only, both lines clear of the strip |

DOM checks run in the same pages: the watermark node is not inside `.screen-capture-content`; under a Full build the Lite stories render no notice.

## Limits

- Screenshots of the two Lite watermark stories, the five-digit story and the Full story were retaken at `d965fb92` (ports 6016 / 6017). `…notice-stage-no-watermark.png` is from `efe1ea5e`; that code path did not change.
- Widths were measured with the macOS system font. Line sizes are computed from the rendered headline width at run time, so other fonts should also match; Segoe UI and Roboto were not checked.
- No BEFORE screenshot from `main`: on `main` every `GenericViewer` story fails to load (`.storybook/stubs/trackAnalyticsEvent.ts` lacks `getSessionReplayId`; fixed in this PR). On `main` the Lite viewer has no code path that shows a notice.
- Not run: Forge tunnel, CI-deployed staging. Both need a `paywall-enforcement:policy:<cloudId>` key in the staging KV namespace, which was not authorised.
- Local full unit run: 6898 passed, 9 failed. All 9 are in `tests/unit/prAgentSelectionDiscovery.spec.ts` and `tests/unit/testSelectionDiscovery.spec.ts` with `Cannot find module 'dotenv/config'` (the E2E workspace was not installed in this worktree). CI is the authority for those.
