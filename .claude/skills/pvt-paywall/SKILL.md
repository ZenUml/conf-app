---
name: pvt-paywall
description: >
  Focused production validation for the paywall modal. Tests all interactive elements,
  all dismissal paths, and Mixpanel event firing (upgrade_modal_shown, paywall_continued_editing).
  Invoked automatically by release-app Step 5.5 when paywall-related commits are detected.
  Triggers on "pvt-paywall", "test paywall", "validate paywall".
---

# PVT — Paywall Modal

Focused post-release validation for the paywall feature on `zenuml.atlassian.net` (production).

## Arguments

Usage: `/pvt-paywall [lite] [full] [diagramly]`

- If no variant specified, test lite (paywall is Lite-only).
- Site: always production (`zenuml.atlassian.net`).

## Prerequisites

- You must be logged into `zenuml.atlassian.net` in the browser.
- A Confluence page with a ZenUML sequence diagram macro must exist on that site.
  Use the existing smoke-test page if one is available.
- localStorage mocks simulate a saturated space — no real CSS flag change needed.
- **Browser automation:** Use Playwright with `frameLocator()` to interact with content inside the Forge iframe. `claude-in-chrome`, `chrome-devtools-mcp`, and `browser-use` cannot cross the Forge iframe boundary (see CLAUDE.md § Browser Automation and E2E Test Principles).

## Steps

### 1. Open production and navigate to a macro page

Open `https://zenuml.atlassian.net` in the browser. Navigate to a Confluence page
that contains a ZenUML sequence macro (the smoke test page works).

### 2. Set localStorage mocks to simulate a saturated space

In Chrome DevTools (F12), open the Console tab. In the context picker dropdown at the top-left of the Console panel, switch from `top` to the ZenUML Forge iframe frame (look for a frame with origin `cdn.prod.atlassian-dev.net`). Then run:

```js
localStorage.setItem('mockCSSEnabled', 'true');
localStorage.setItem('mockMacroCount', '105');
localStorage.setItem('mockSpacePaid', 'false');
```

Reload the page for the mocks to take effect.

### 3. Trigger the paywall — click Edit

Click the Edit button rendered inside the ZenUML macro's Forge iframe (the blue-outlined 'Edit' button in the macro header). Note: the button may take 1–2 seconds to appear after page load while the app fetches edit permissions asynchronously.

**Expected:** The paywall modal appears. The ZenUML editor does NOT mount.

**Fail if:** The editor mounts directly, or no modal appears.

### 4. Verify all modal elements are present

Inspect the modal and confirm all of the following are visible:

- Editable message textarea — pre-filled with the pitch template
- The textarea contains NO unreplaced `{placeholder}` tokens (e.g., `{spaceName}`, `{n}`, `{stripeUrl}` must all be substituted)
- `Copy message` button
- `Open in email` button
- `Continue editing` button
- × (close) button
- At least one upgrade CTA link (marketplace or enterprise bundle)

**Fail if:** Any element is missing, or the textarea still contains `{placeholder}` tokens.

### 5. Verify each dismissal path does NOT grant edit access

Test each of the following. After each, confirm the editor is not mounted (the Edit button is still visible, the editor iframe is absent). Reopen the modal between tests by clicking Edit again.

| Action | Expected result |
|---|---|
| Click × button | Modal closes. Editor absent. |
| Press Escape | Modal closes. Editor absent. |
| Click modal backdrop | Modal closes. Editor absent. |
| Click a CTA upgrade link | External URL opens (new tab). Editor absent on original page. |

**Fail if:** Editor mounts after any of these dismissal actions.

### 6. Verify Copy message button

Click `Copy message`. Then open the browser console and run:

```js
navigator.clipboard.readText().then(t => console.log('CLIPBOARD:', t));
```

**Expected:** The clipboard contains the full rendered pitch message with no `{placeholder}` tokens remaining.

**Fail if:** Clipboard is empty, or message contains unreplaced tokens.

### 7. Verify Open in email button

Inspect the `Open in email` button's href attribute (right-click → Inspect). It should be a `mailto:` link.

**Expected:** `href` starts with `mailto:` and the URL-decoded href contains a non-empty `subject` parameter and a `body` parameter that includes the pitch message text and a Stripe URL.

**Fail if:** href is absent, not a mailto link, subject is empty, or body is empty.

### 8. Verify Continue editing grants access

Click Edit again to reopen the modal. Click `Continue editing`.

**Expected:** Modal closes. ZenUML editor mounts inside the Forge iframe.

**Fail if:** Modal stays open, or editor does not appear within 10 seconds.

### 9. Verify Mixpanel events

Wait at least 2 minutes after completing step 8 before querying — Mixpanel ingestion typically takes 30–120 seconds. Then query for the last 1 hour filtered to `client_domain = zenuml`. If both counts return 0, wait another minute and retry once before declaring FAIL.

Use `mcp__mixpanel__Run-Query` with project_id=3373228, last 1 hour, chartType=bar:

**Query A — upgrade_modal_shown count:**
```
event: upgrade_modal_shown
filter: client_domain equals "zenuml"
measurement: total
```
**Expected:** count ≥ number of times modal was opened in steps 3–8 (minimum 5 appearances).

**Query B — paywall_continued_editing count:**
```
event: paywall_continued_editing
filter: client_domain equals "zenuml"
measurement: total
```
**Expected:** count ≥ 1 (from step 8).

**Fail if:** Either event count is 0.

### 10. Clean up localStorage mocks

In the browser console, remove the test mocks:

```js
localStorage.removeItem('mockCSSEnabled');
localStorage.removeItem('mockMacroCount');
localStorage.removeItem('mockSpacePaid');
```

After removing the mocks and reloading, click the Edit button again. The paywall modal must NOT appear and the editor must mount normally. If the editor is still blocked, confirm all three localStorage keys were removed correctly.

## Pass/Fail Report

```
## pvt-paywall: PASS | FAIL
- Step 3 (modal appears on edit): PASS | FAIL
- Step 4 (all elements present): PASS | FAIL
- Step 5 (dismissals don't grant access): PASS | FAIL — <which action failed>
- Step 6 (copy message): PASS | FAIL
- Step 7 (open in email): PASS | FAIL
- Step 8 (continue editing mounts editor): PASS | FAIL
- Step 9 (Mixpanel events): PASS | FAIL — upgrade_modal_shown={n}, paywall_continued_editing={n}
```
