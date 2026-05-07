---
name: pvt-paywall
description: >
  Focused production validation for the paywall modal. Tests every interactive element,
  every dismissal path, and Mixpanel event firing (upgrade_modal_shown, upgrade_cta_clicked
  with ui_component=modal, paywall_continued_editing). Invoked automatically by release-app
  Step 5.5 when paywall-related commits are detected.
  Triggers on "pvt-paywall", "test paywall", "validate paywall".
---

# PVT — Paywall Modal

Focused post-release validation for the paywall modal on `zenuml.atlassian.net` (production).

## Arguments

Usage: `/pvt-paywall [lite] [full] [diagramly]`

- If no variant specified, test lite (paywall is Lite-only).
- Site: always production (`zenuml.atlassian.net`).

## Prerequisites

- You must be logged into `zenuml.atlassian.net` in the browser.
- A Confluence page with a ZenUML / Mermaid / Sequence macro must exist on that site. The PVT smoke-test pages under `Test pages → PVT → 2026 → 2026-MM` are good candidates.
- localStorage mocks simulate a saturated space — no real CSS flag change needed.
- **Browser automation:** Use Playwright with `frameLocator()` / `contentFrame()` to interact with content inside the Forge iframe. `claude-in-chrome`, `chrome-devtools-mcp`, and `browser-use` cannot cross the Forge iframe boundary (see CLAUDE.md § Browser Automation).

## What the modal looks like (current)

The current modal is `src/components/UpgradePrompt/UpgradePrompt.vue`. Single variant, single funnel. Structure:

- **Header**: `This space has reached the ZenUML Lite limit ({{macrosLimit}} macros).`
- **Subhead**: `Existing diagrams still render. To create or edit, upgrade the space.`
- **Heading**: `Pick the upgrade that fits your team`
- **Two side-by-side pricing cards**:
  - Marketplace card with primary button `Upgrade →`
  - Enterprise Bundle card with secondary button `Get Bundle →`
- **Footer**: a `Continue editing without upgrading` button (`data-testid="continue-editing-btn"`) on the left and a `Why do I need to upgrade? →` link on the right.
- **No × button.** Dismissal is via Escape or clicking the backdrop. The CTAs open external tabs and *deliberately do not close the modal* (closing tears down the Forge iframe and races `router.open()`; see `useUpgradeTracking.ts:64-68`).

If the modal you see has a "Copy message" or "Open in email" button, you're on stale code (pre-2026-05-02 multi-variant Bystander) — **stop and report**, do not continue.

## Steps

### 1. Open production and navigate to a macro page

Open `https://zenuml.atlassian.net` in the browser. Navigate to a Confluence page that contains a ZenUML or Mermaid macro.

### 2. Set localStorage mocks to simulate a saturated, CSS-enrolled, unpaid space

Set the mocks inside the **Forge iframe frame** (origin `cdn.prod.atlassian-dev.net`):

```js
const frame = page.frames().find(f => f.url().includes('cdn.prod.atlassian-dev.net'));
await frame.evaluate(() => {
  localStorage.setItem('mockCSSEnabled', 'true');
  localStorage.setItem('mockMacroCount', '105');
  localStorage.setItem('mockSpacePaid', 'false');
});
await page.reload();
await page.waitForTimeout(5000); // give the iframe time to remount with mocks active
```

Manual fallback: open Chrome DevTools (F12), switch the Console context to the iframe origin, run the three `localStorage.setItem` calls, reload the page.

### 3. Trigger the paywall — click Edit

Inside the iframe, click the `Edit` button in the macro header. (May take 1–2 seconds to appear while the app fetches edit permissions.)

**Expected:** the paywall modal renders. The ZenUML editor does NOT mount.

**Fail if:** the editor opens, or no modal appears.

### 4. Verify modal elements are present

In the iframe document, confirm all of the following are visible:

- Header text contains `This space has reached the ZenUML Lite limit`
- Subhead text contains `Existing diagrams still render`
- Heading text contains `Pick the upgrade that fits your team`
- A button with text `Upgrade →` (Marketplace primary CTA)
- A button with text `Get Bundle →` (Enterprise Bundle secondary CTA)
- A button with `data-testid="continue-editing-btn"` (text: `Continue editing without upgrading`)
- An anchor with text `Why do I need to upgrade? →` whose href is `https://zenuml.com/upgrade/` and `target="_blank"`

**Fail if:** any of the above is missing.

### 5. Verify dismissals do NOT grant edit access

Reopen the modal between each test by clicking `Edit` again on the macro.

| Action | Expected |
|---|---|
| Press Escape | Modal closes. Editor not mounted. |
| Click the dark backdrop (`bg-black bg-opacity-50`) outside the white card | Modal closes. Editor not mounted. |
| Click `Upgrade →` (Marketplace) | New tab opens (Atlassian Marketplace listing). **Modal stays open.** Editor not mounted on the original tab. |
| Click `Get Bundle →` (Enterprise) | New tab opens (Stripe Checkout). **Modal stays open.** Editor not mounted. |
| Click `Why do I need to upgrade? →` | New tab opens (zenuml.com/upgrade). Modal stays open. Editor not mounted. |

**Fail if:** the editor mounts after any of these actions, OR the modal closes after a CTA click (CTA closing the modal is the regression that was specifically fixed in `useUpgradeTracking.ts:64-68` — protect it).

### 6. Verify the recent `ui_component=modal` instrumentation fix

After clicking each CTA in step 5, capture the outgoing Mixpanel network request. Confirm the request body contains `"ui_component":"modal"` (this property was previously hardcoded as `"tooltip"` — the fix landed in PR #32, deployed 2026-05-07).

```js
// Listen for Mixpanel requests
const captured = [];
page.on('request', req => {
  const url = req.url();
  if (url.includes('mixpanel') || url.includes('/track')) {
    captured.push({ url, body: req.postData() });
  }
});
// ... click Marketplace and Bundle CTAs ...
// Then verify:
const ctaRequests = captured.filter(r => r.body?.includes('upgrade_cta_clicked'));
const allHaveModal = ctaRequests.every(r => r.body.includes('"ui_component":"modal"'));
```

**Fail if:** any `upgrade_cta_clicked` request from the modal carries `"ui_component":"tooltip"` (the regression).

### 7. Verify Continue editing grants access

Click `Edit` again to reopen the modal. Click the `Continue editing without upgrading` button.

**Expected:** the modal closes. The ZenUML editor mounts inside the Forge iframe within ~10 seconds.

**Fail if:** the modal stays open, or the editor never mounts.

### 8. Verify Mixpanel events (delayed sanity check)

This step is OPTIONAL when step 6 already passed (we have direct network evidence). Skip if you're time-constrained. If running it: wait at least 2 minutes after step 7 before querying — Mixpanel ingestion takes 30–120 seconds.

Use `mcp__claude_ai_Mixpanel__Run-Query` with project_id=3373228, last 1 hour, filtered to `client_domain = zenuml`.

**Query A — `upgrade_modal_shown`:** count ≥ number of times the modal was opened in steps 3–7.

**Query B — `paywall_continued_editing`:** count ≥ 1 (from step 7).

**Query C — `upgrade_cta_clicked` with breakdown by `ui_component`:** every event from this run should be tagged `ui_component=modal`.

### 9. Clean up localStorage mocks

```js
const frame = page.frames().find(f => f.url().includes('cdn.prod.atlassian-dev.net'));
await frame.evaluate(() => {
  localStorage.removeItem('mockCSSEnabled');
  localStorage.removeItem('mockMacroCount');
  localStorage.removeItem('mockSpacePaid');
});
await page.reload();
```

Verify cleanup: after the reload, click `Edit` again. The paywall modal must NOT appear and the editor must mount normally.

## Pass/Fail Report

```
## pvt-paywall: PASS | FAIL
- Step 3 (modal appears on edit): PASS | FAIL
- Step 4 (all elements present): PASS | FAIL
- Step 5 (dismissals don't grant access): PASS | FAIL — <which action failed>
- Step 6 (ui_component=modal in CTA requests): PASS | FAIL
- Step 7 (continue editing mounts editor): PASS | FAIL
- Step 8 (Mixpanel ingestion check): PASS | FAIL | SKIPPED — modal_shown={n}, continued={n}, cta_modal={n}
- Step 9 (cleanup leaves modal disabled): PASS | FAIL
```
