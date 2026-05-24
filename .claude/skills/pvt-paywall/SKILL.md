---
name: pvt-paywall
description: >
  Focused production validation for the paywall modal across both trigger paths:
  Edit (existing) and Fullscreen viewer (added 2026-05-17). Tests every interactive
  element, every dismissal path, post-dismiss state per trigger, and Mixpanel events
  (upgrade_modal_shown, paywall_triggered with action_type={page_editor,fullscreen_viewer},
  advocacy_message_copied with ui_component=modal, paywall_continued_editing).
  Invoked automatically by release-app Step 5.5 when paywall-related commits are detected.
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

## Two trigger paths — both must be tested

The same `UpgradePrompt` modal fires from two surfaces in Lite when the space is saturated. Both share the modal UI but differ in trigger, analytics tagging, and post-dismiss state:

| Path | Trigger | `action_type` | `ui_component` | After dismiss |
|---|---|---|---|---|
| **A. Edit (page-editor gate)** | Click `Edit` on a macro | `page_editor` (or `page_editor_create` for new diagrams) | `viewer_notice` | Editor mounts (Workspace / ForgeGraphEditor / etc.) |
| **B. Fullscreen viewer gate** | Click `Fullscreen` on a macro | `fullscreen_viewer` | `modal` | Read-only diagram remains visible underneath |

Code paths:
- A: `tryPageEditorPaywall` in `src/utils/paywall/mountPaywallGate.ts`, fired from `forgeIndex.ts` + `forge-{graph,embed,swagger}-editor.ts`
- B: `tryFullscreenViewerPaywall` in same file, fired from `forgeIndex.ts` + `forge-{graph,embed}-viewer.ts` + `forge-swagger-ui.ts`

Run the full validation flow once per path. Step 8 (Mixpanel) checks both action_types in a single query at the end.

## What the modal looks like (current)

The current modal is `src/components/UpgradePrompt/UpgradePrompt.vue`. Single variant, advocacy-first, identical UI across both trigger paths. Structure:

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

### 3. Trigger the paywall — run both paths

Run **path A** then **path B** below. The validation in steps 4–7 applies to each path.

#### 3A. Trigger via Edit (page-editor gate)

Inside the iframe, click the `Edit` button in the macro header. (May take 1–2 seconds to appear while the app fetches edit permissions.)

**Expected:** the paywall modal renders inside a Forge fullscreen modal. The editor mounts *underneath* the modal — visible after dismiss.

**Fail if:** no modal appears, OR the editor opens without the modal layered on top.

After validating, dismiss with `Continue editing without upgrading` (step 7 path A) and close the fullscreen modal before path B.

#### 3B. Trigger via Fullscreen (viewer gate, added 2026-05-17)

Inside the iframe, click the `Fullscreen` button in the macro header.

**Expected:** the paywall modal renders inside a Forge fullscreen modal. The read-only diagram renders *underneath* the modal — visible after dismiss.

**Fail if:** no modal appears, OR the diagram is hidden / blank after dismiss.

Verify the diagram is visible behind the modal *before* dismissing (it should be dimmed by the 75% backdrop but discernible).

### 4. Verify modal elements are present (run after each trigger)

In the iframe document, confirm all of the following are visible:

- Header text contains `This space has reached the ZenUML Lite limit`
- Subhead text contains `Existing diagrams still render`
- Control `data-testid="draft-toggle-btn"` (draft preview toggle)
- Button `data-testid="advocacy-copy-btn"` with label containing `Copy upgrade request`
- Button `data-testid="continue-editing-btn"` (text: `Continue editing without upgrading`)
- An anchor with text `Why do I need to upgrade? →` whose href is `https://zenuml.com/upgrade/` and `target="_blank"`

**Fail if:** any of the above is missing.

### 5. Verify dismissals and external link do NOT grant edit access

Reopen the modal between each test by reclicking the trigger (`Edit` for path A, `Fullscreen` for path B). Run for **at least path A** (most user friction); path B can spot-check Escape + backdrop only.

| Action | Expected (path A — Edit) | Expected (path B — Fullscreen) |
|---|---|---|
| Press Escape | Modal closes. Editor mounted underneath becomes interactive. | Modal closes. Read-only diagram visible. No editor. |
| Click the dark backdrop outside the white card | Same as Escape. | Same as Escape. |
| Click `Why do I need to upgrade? →` | New tab opens (zenuml.com/upgrade). Original tab modal stays open. | Same. |

**Fail if:** path A — the editor doesn't become interactive after dismiss; path B — the diagram is gone after dismiss, or an editor mounted (the fullscreen *viewer* gate must never mount the editor).

### 6. Verify advocacy copy instrumentation (run once, either path)

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

### 7. Verify Continue editing — post-dismiss state differs by path

Click the trigger again to reopen the modal, then click `Continue editing without upgrading`.

| Path | Expected post-dismiss state |
|---|---|
| **A — Edit** | Modal closes. The ZenUML editor (Workspace / ForgeGraphEditor / SwaggerForgeEditorShell / ForgeEmbedEditor) mounts and becomes interactive within ~10 seconds. |
| **B — Fullscreen** | Modal closes. The read-only diagram remains visible inside the fullscreen modal. No editor. User can close the fullscreen modal via Confluence's `Close Modal` button (top right) to return to the page. |

**Fail if:** path A — editor never mounts; path B — editor mounts (gate must keep this surface read-only).

### 8. Verify Mixpanel events (delayed sanity check)

Optional when step 6 already passed. If running: wait at least 2 minutes after step 7 — Mixpanel ingestion takes 30–120 seconds.

Use `mcp__claude_ai_Mixpanel__Run-Query` with project_id=3373228, last 1 hour, filtered to `client_domain = zenuml`.

**Query A — `upgrade_modal_shown`:** count ≥ total times the modal opened across paths A + B in steps 3–7.

**Query B — `paywall_triggered` broken down by `action_type`:**
- `action_type = page_editor` (or `page_editor_create`): count ≥ 1 (path A)
- `action_type = fullscreen_viewer`: count ≥ 1 (path B)

**Query C — `paywall_continued_editing`:** count ≥ 2 (path A step 7 + path B step 7).

**Query D — `advocacy_message_copied`:** if step 6 exercised copy, count ≥ 1; breakdown by `ui_component` should be `modal` only for this flow.

**Fail if:** Query B is missing either action_type — that means one of the two trigger paths didn't fire its tracking call.

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

Verify cleanup: after the reload, click `Edit` AND `Fullscreen` again. Neither should show the paywall modal — Edit must mount the editor, Fullscreen must open the viewer modal without the upgrade prompt.

## Pass/Fail Report

```
## pvt-paywall: PASS | FAIL
Path A (Edit / page-editor gate)
- Step 3A (modal appears on edit): PASS | FAIL
- Step 4 (all elements present): PASS | FAIL
- Step 5 (dismissals — Escape / backdrop / link): PASS | FAIL — <which action failed>
- Step 7 (continue editing mounts editor): PASS | FAIL

Path B (Fullscreen / viewer gate)
- Step 3B (modal appears on fullscreen, diagram visible underneath): PASS | FAIL
- Step 4 (all elements present): PASS | FAIL
- Step 5 (dismissals leave diagram visible, no editor): PASS | FAIL
- Step 7 (continue dismisses modal, diagram stays, no editor): PASS | FAIL

Shared
- Step 6 (advocacy copy analytics — ui_component=modal): PASS | FAIL
- Step 8 (Mixpanel — both action_types present): PASS | FAIL | SKIPPED — modal_shown={n}, triggered_page_editor={n}, triggered_fullscreen_viewer={n}, continued={n}, advocacy={n}
- Step 9 (cleanup leaves both surfaces unblocked): PASS | FAIL
```
