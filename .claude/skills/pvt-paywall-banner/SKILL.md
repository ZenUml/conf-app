---
name: pvt-paywall-banner
description: >
  Focused production validation for the paywall WARNING page-banner (Lite, 85–99 macro
  band) on the single `zenuml-page-banner` Forge pageBanner host. Covers render + count,
  both CTAs (Copy admin message, Request extension), dismiss/7-day snooze, the critical-band
  (100+) no-banner boundary, the below-band (<85) no-banner case, and single-host priority
  (paywall outranks CSAT). Checks Mixpanel events (paywall_banner_shown, paywall_banner_dismissed,
  advocacy_message_copied, extension_request_clicked — all surface=page_banner). This is the
  full granular matrix; CI keeps only a slim 3-test subset in
  tests/e2e-tests/tests/insert/paywall-page-banner.spec.ts. For the paywall MODAL (100+ hard
  gate) use pvt-paywall instead. Triggers on "pvt-paywall-banner", "test paywall banner",
  "validate warning banner".
---

# PVT — Paywall Warning Page-Banner

Focused post-release validation for the **Lite warning page-banner** — the soft nudge shown to
Lite spaces in the **85–99 macro band** (approaching the 100-macro limit). It renders in the
single `confluence:pageBanner` host (`zenuml-page-banner`), which picks **paywall warning > CSAT > none**.

This is the **banner**. For the **hard paywall modal** (100+, blocks editing) use **pvt-paywall**.
The two never coexist: the banner gate returns false at 100+ (`severity==='critical'`) precisely
so the modal owns that band.

## Arguments

Usage: `/pvt-paywall-banner` — **Lite only.**

The warning marker is written **only on Lite** (`persistTargetingMarker()` in
`src/composables/useCustomerSuccessService.ts` returns early when `!isLite()`), so the banner
cannot appear on Full/Diagramly. Don't run this against those variants.

Site: production `zenuml.atlassian.net` (Lite). Staging `lite-stg.atlassian.net` or a Forge
tunnel → `lite-dev.atlassian.net` work too for pre-release checks.

## Prerequisites

- Logged into the target site; a page with a **ZenUML/Mermaid/Sequence macro** exists (the macro
  iframe is what writes the targeting marker). PVT smoke pages under `Test pages → PVT → …` work.
- **localStorage mocks live in the Forge iframe origin** (`*.cdn.prod.atlassian-dev.net` on a
  deployed env, or `localhost:8000` under a tunnel) — **not** the top-level Confluence page.
  Setting them on the page domain is a silent no-op. See the **spot-check** skill § "Setting
  localStorage mocks".
- **Playwright only** — Forge Custom UI renders in cross-origin iframes; use `frameLocator()` /
  `contentFrame()`. `claude-in-chrome` / `chrome-devtools-mcp` / `browser-use` cannot cross the
  boundary (CLAUDE.md § Browser automation).

## How the banner is driven (the cross-load signal)

The macro iframe (writer) and the page-banner iframe (reader) share the same Forge origin, so
they share localStorage. The flow is deliberately **two page loads**:

1. Set mocks in the Forge iframe, then **reload** → the macro re-renders and writes the targeting
   marker `paywallWarning:<domain>:<space>` (domain = Confluence subdomain, no `.atlassian.net`).
2. **Reload again** → the page-banner host reads the marker on load and mounts the banner.

> **Impression taper trap (since 2026-09-07).** Once the banner has mounted ONCE in this browser
> for this `domain:space`, a further reload inside 24h shows **nothing** — by design, not a
> regression (`isTaperGapMet` in `src/utils/paywall/warningBanner.ts`: 2nd/3rd impression ≥ 24h
> apart, 4th+ ≥ 7d). To re-show it, either clear `paywallBanner:<domain>:<space>` or back-date
> its `lastShownAt` (the E2E helper `ageLastImpression(page, 25)` does exactly this). Every
> `paywall_banner_shown` carries `show_count` (ordinal of this impression) and
> `hours_since_last_shown` — assert them when verifying the taper in Mixpanel.

```js
// In the Forge-iframe origin (cdn.prod.atlassian-dev.net or localhost:8000):
const frame = page.frames().find(f =>
  f.url().includes('cdn.prod.atlassian-dev.net') || f.url().includes('localhost:8000'));
await frame.evaluate(() => {
  localStorage.setItem('zenumlDebug', 'true');
  localStorage.setItem('mockCSSEnabled', 'true');
  localStorage.setItem('mockSpacePaid', 'false');
  localStorage.setItem('mockMacroCount', '90');     // 85–99 = warning; ≥100 = critical; <85 = none
});
await page.reload(); await page.waitForTimeout(6000);  // macro writes the warning marker
await page.reload(); await page.waitForTimeout(6000);  // page-banner reads it and mounts
```

Banner host iframe: `div[data-testid="forge-page-banner-wrapper"] iframe` (the host has **no**
`data-module-key`). Drill in with `page.frameLocator(...)`.

Markers (Forge-iframe localStorage): `paywallWarning:<domain>:<space>` (targeting),
`paywallBanner:<domain>:<space>` (dismissal — stamps `dismissedAt`, starts the 7-day snooze
`WARNING_BANNER_SUPPRESSION_MS`). Clear them between scenarios.

## data-testids (`PaywallWarningBanner.vue`)

| testid | element |
|---|---|
| `paywall-warning-banner` | banner root (contains "N of 100") |
| `paywall-banner-request-extension` | Request-extension CTA |
| `paywall-banner-copy-admin` → `paywall-banner-copied` | Copy-admin CTA; flips to "✓ Copied" after click |
| `paywall-banner-dismiss` | dismiss (×) |

## Scenario matrix

Run each; screenshot after the key assertion. Clear markers/mocks between scenarios.

- [ ] **1. Warning band renders** — `mockMacroCount=90`, `mockSpacePaid=false`, `mockCSSEnabled=true` →
  after the two-reload signal, `paywall-warning-banner` is visible and contains **"90 of 100"**;
  both CTAs (`paywall-banner-request-extension`, `paywall-banner-copy-admin`) visible.
- [ ] **2. Copy admin message CTA** — click `paywall-banner-copy-admin` → button flips to
  `paywall-banner-copied` ("✓ Copied"); clipboard holds the advocacy text (`buildAdvocacyMessage`).
- [ ] **3. Request extension CTA** — click `paywall-banner-request-extension` → `openUrl()` opens the
  Service Desk URL in a new tab (`buildExtensionRequestMessage` + `requestUrl`). Capture the popup;
  assert URL matches `/servicedesk|customer\/portal/i`.
- [ ] **4. Draft preview** (if present) — expanding the advocacy draft preview fires
  `advocacy_draft_preview_clicked`.
- [ ] **5. Dismiss → 7-day snooze** — click `paywall-banner-dismiss` → `paywallBanner:<domain>:<space>`
  records `dismissedAt`; reload → banner gone despite the warning marker still being written.
- [ ] **6. Over-limit only (> 100) → banner; ≤ 100 → NO banner.** *(Corrected 2026-09-07 — items 6/7
  previously described the retired 85–99 warning band and the retired hard modal.)*
  `mockMacroCount=100` (or any 85–99 value) → marker written, but `isWarningBannerVisible` returns
  false at `macroCount <= 100` → no banner. `mockMacroCount=101` → banner. The block modal is
  retired (`shouldBlockActions` is hardcoded false), so there is no competing surface at 100+.
- [ ] **7. Taper** — after item 1's first impression, reload immediately → **no** banner
  (`show_count` would have been 2, inside the 24h gap). `ageLastImpression(page, 25)` (or edit
  `lastShownAt` by hand) → reload → banner, and its `paywall_banner_shown` carries `show_count: 2`,
  `hours_since_last_shown: 25`.
- [ ] **8. Single-host priority** — warning band eligible **and** a fresh `csatPending-<domain>` armed →
  the single host renders ONLY the paywall banner; CSAT survey (`.pb-bar`) absent. Proves the
  one-host consolidation (PR #202) needs no cross-iframe defer.

## Mixpanel (project_id 3373228)

All banner events carry **`surface: page_banner`**. Verify via `mcp__claude_ai_Mixpanel__Run-Query`:

| Event | Fires on |
|---|---|
| `paywall_banner_shown` | banner mounts in the warning band |
| `advocacy_message_copied` | Copy-admin CTA (this surface = `page_banner`; the modal's copy is `ui_component=modal`) |
| `extension_request_clicked` | Request-extension CTA |
| `advocacy_draft_preview_clicked` | draft preview expanded |
| `paywall_banner_dismissed` | dismiss (×) |

## Cleanup

Remove injected mocks/markers (`mockMacroCount`, `mockSpacePaid`, `mockCSSEnabled`,
`paywallWarning:*`, `paywallBanner:*`, `csatPending*`) from the Forge-iframe localStorage and
reload.

## Related

- **pvt-paywall** — the hard paywall **modal** (100+ gate; Edit + Fullscreen trigger paths).
- **spot-check** — ad-hoc verification; Forge-iframe mock-setting recipe.
- Code: `src/components/UpgradePrompt/PaywallWarningBanner.vue`, `src/utils/paywall/warningBanner.ts`,
  `src/routes/pageBanner.ts` (host priority), `src/composables/useCustomerSuccessService.ts`
  (`persistTargetingMarker`, Lite gate). CI subset:
  `tests/e2e-tests/tests/insert/paywall-page-banner.spec.ts` + `helpers/pageBanner.ts`.
