# PR #1188 evidence — per-site paywall enforcement, watermark slice

- BEFORE (base): `2ae6cbb7` (`main`)
- AFTER (candidate): `efe1ea5e` (`feat/per-site-paywall-enforcement`)
- Captured 2026-11-15 (AEDT) with agent-browser 0.35.0 against local Storybook, viewport 1280 wide.
- Fixture data only. "Login flow", the space key `DOCS` and the counts 2,282 / 100 are invented.

## How the screenshots were made

1. `PRODUCT_TYPE=lite pnpm exec storybook dev -p 6117 --no-open --ci` (Lite build).
2. Open `iframe.html?id=<story id>&viewMode=story`, wait for the viewer, screenshot.
3. The stories mount the real `GenericViewer`. Only the bridge transport is stubbed: `/api/space-status` returns the `enforcement` object shown in `LicenseNotice.stories.ts`.
4. `full-notice-on-unchanged.png` comes from a second Storybook started with `PRODUCT_TYPE=full` on port 6118, story `viewer-licensenotice--notice-on`.

| File | Story | Stubbed `enforcement` | Observed |
|---|---|---|---|
| `viewer-licensenotice--lite-limit-reached-2282.png` | `viewer-licensenotice--lite-limit-reached-2282` | stage `watermark`, count 2282, `effects.watermark = true` | watermark `UPGRADE REQUIRED` / `2,282 of 100 Lite diagrams in this space · Ask your Confluence admin`; strip "Lite diagram limit reached"; button "View plan and usage" |
| `viewer-licensenotice--lite-limit-reached-exactly-100.png` | `…--lite-limit-reached-exactly-100` | stage `watermark`, count 100 | same notice with `100 of 100` |
| `viewer-licensenotice--lite-notice-stage-no-watermark.png` | `…--lite-notice-stage-no-watermark` | stage `notice`, `effects.watermark = false` | diagram only, no watermark, no strip |
| `full-notice-on-unchanged.png` | `viewer-licensenotice--notice-on` (Full build) | n/a | Full text unchanged: `NO ACTIVE LICENSE`, "Upgrade on Marketplace" |

DOM checks run in the same pages: the watermark node is not inside `.screen-capture-content`; under a Full build the Lite stories render no notice.

## Limits

- No BEFORE screenshot from `main`: on `main` every `GenericViewer` story fails to load (`.storybook/stubs/trackAnalyticsEvent.ts` lacks `getSessionReplayId`; fixed in this PR). On `main` the Lite viewer has no code path that shows a notice.
- The second watermark line is partly covered by the strip on this short fixture diagram. The Full notice has the same geometry (see `full-notice-on-unchanged.png`).
- Not run: Forge tunnel, CI-deployed staging. Both need a `paywall-enforcement:policy:<cloudId>` key in the staging KV namespace, which was not authorised.
- Local full unit run: 6898 passed, 9 failed. All 9 are in `tests/unit/prAgentSelectionDiscovery.spec.ts` and `tests/unit/testSelectionDiscovery.spec.ts` with `Cannot find module 'dotenv/config'` (the E2E workspace was not installed in this worktree). CI is the authority for those.
