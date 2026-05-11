---
name: pvt-paywall
description: >
  Focused production validation for the paywall modal. Tests every interactive element,
  every dismissal path, and Mixpanel event firing (upgrade_modal_shown, advocacy_message_copied
  with ui_component=modal, paywall_continued_editing). Invoked automatically by release-app
  Step 5.5 when paywall-related commits are detected.
  Triggers on "pvt-paywall", "test paywall", "validate paywall".
---

# PVT — Paywall Modal

Focused post-release validation for the paywall modal on `zenuml.atlassian.net` (production).

## Arguments

Usage: `/pvt-paywall [lite] [full] [diagramly]`

### Which product (variant) to test

1. **Explicit flags** — Test only the variants named (paywall UX is **Lite-first**, but follow explicit args).
2. **Infer from conversation** — Prefer the variant from the **current release or thread** (e.g. `/release-app lite` → lite). Do **not** ignore an explicit Diagramly/Full discussion.
3. **If still ambiguous** — Prefer **lite** for paywall-modal behaviour (space-limit funnel), **unless** the conversation is clearly about another variant — then ask once.

Site: always production (`zenuml.atlassian.net`).

## Prerequisites

- You must be logged into `zenuml.atlassian.net` in the browser.
- A Confluence page with a ZenUML / Mermaid / Sequence macro must exist on that site. The PVT smoke-test pages under `Test pages → PVT → 2026 → 2026-MM` are good candidates.
- localStorage mocks simulate a saturated space — no real CSS flag change needed.
- **Browser automation:** Use Playwright with `frameLocator()` / `contentFrame()` to interact with content inside the Forge iframe. `claude-in-chrome`, `chrome-devtools-mcp`, and `browser-use` cannot cross the Forge iframe boundary (see CLAUDE.md § Browser Automation).

## What the modal looks like (current)

The current modal is `src/components/UpgradePrompt/UpgradePrompt.vue`. Single variant, advocacy-first. Structure:

- **Header**: `This space has reached the ZenUML Lite limit ({{macrosLimit}} macros).`
- **Subhead**: `Existing diagrams still render. To create or edit, upgrade the space.`
- **Hero** (`PaywallHero`) — illustration + factual framing
- **Collapsible draft preview** — control `data-testid="draft-toggle-btn"`; expands to show the templated message body
- **Primary CTA**: `Copy upgrade request` (`data-testid="advocacy-copy-btn"`) — copies advocacy text; on success fires Mixpanel `advocacy_message_copied` with `ui_component=modal`
- **Footer**: `Continue editing without upgrading` (`data-testid="continue-editing-btn"`) and external link `Why do I need to upgrade? →` (`https://zenuml.com/upgrade/`, `target="_blank"`)
- **No × button.** Dismissal is via Escape or clicking the backdrop.

If the modal still shows side-by-side Marketplace / Enterprise Bundle cards with `Upgrade →` / `Get Bundle →`, the Forge host is on **stale code** — stop and report.

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
- Control `data-testid="draft-toggle-btn"` (draft preview toggle)
- Button `data-testid="advocacy-copy-btn"` with label containing `Copy upgrade request`
- Button `data-testid="continue-editing-btn"` (text: `Continue editing without upgrading`)
- An anchor with text `Why do I need to upgrade? →` whose href is `https://zenuml.com/upgrade/` and `target="_blank"`

**Fail if:** any of the above is missing.

### 5. Verify dismissals and external link do NOT grant edit access

Reopen the modal between each test by clicking `Edit` again on the macro.

| Action | Expected |
|---|---|
| Press Escape | Modal closes. Editor not mounted. |
| Click the dark backdrop outside the white card | Modal closes. Editor not mounted. |
| Click `Why do I need to upgrade? →` | New tab opens (zenuml.com/upgrade). Modal may stay open. Editor not mounted on the original tab until user uses Continue editing. |

**Fail if:** the editor mounts after Escape or backdrop without an explicit Continue flow.

### 6. Verify advocacy copy instrumentation

After a successful clipboard write from `advocacy-copy-btn`, capture the outgoing Mixpanel request. Confirm the POST body includes the advocacy event name and `"ui_component":"modal"`.

```js
const captured = [];
page.on('request', req => {
  const url = req.url();
  if (url.includes('mixpanel') || url.includes('/track')) {
    captured.push({ url, body: req.postData() });
  }
});
// ... click Copy upgrade request after secure clipboard is available ...
const advocacyRequests = captured.filter(r => r.body?.includes('advocacy_message_copied'));
const allHaveModal = advocacyRequests.every(r => r.body.includes('"ui_component":"modal"'));
```

**Fail if:** a successful copy does not emit an analytics request tagged `ui_component=modal`.

### 7. Verify Continue editing grants access

Click `Edit` again to reopen the modal. Click the `Continue editing without upgrading` button.

**Expected:** the modal closes. The ZenUML editor mounts inside the Forge iframe within ~10 seconds.

**Fail if:** the modal stays open, or the editor never mounts.

### 8. Verify Mixpanel events (delayed sanity check)

Optional when step 6 already passed. If running: wait at least 2 minutes after step 7 — Mixpanel ingestion takes 30–120 seconds.

Use `mcp__claude_ai_Mixpanel__Run-Query` with project_id=3373228, last 1 hour, filtered to `client_domain = zenuml`.

**Query A — `upgrade_modal_shown`:** count ≥ number of times the modal was opened in steps 3–7.

**Query B — `paywall_continued_editing`:** count ≥ 1 (from step 7).

**Query C — `advocacy_message_copied`:** if step 6 exercised copy, count ≥ 1; breakdown by `ui_component` should be `modal` only for this flow.

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
- Step 5 (dismissals / external link): PASS | FAIL — <which action failed>
- Step 6 (advocacy copy analytics): PASS | FAIL
- Step 7 (continue editing mounts editor): PASS | FAIL
- Step 8 (Mixpanel ingestion check): PASS | FAIL | SKIPPED — modal_shown={n}, continued={n}, advocacy={n}
- Step 9 (cleanup leaves modal disabled): PASS | FAIL
```
