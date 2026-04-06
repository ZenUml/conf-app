---
name: edit-macro
description: Edit an existing ZenUML/Mermaid/PlantUML/Graph/OpenAPI macro on a Confluence page using Playwright browser automation. Use this skill when the user asks to edit a macro, switch diagram types, change macro content, click Edit on a macro, or interact with the macro editor dialog in the Confluence page editor. Covers both Forge (Lite) and Connect (Full) app variants. This skill provides exact selectors and efficient Playwright patterns so you can navigate without excessive snapshots or screenshots.
---

# Edit Macro via Playwright

This skill provides the exact DOM selectors and step-by-step Playwright workflow for editing an existing macro in the Confluence page editor and optionally switching its diagram type. It works for both Forge (Lite) and Connect (Full) app variants.

The goal is token-efficient automation: use `browser_evaluate` with known selectors instead of repeated snapshots/screenshots to understand the page.

## Prerequisites

- Playwright MCP connected (`mcp__playwright-conf-app__*` tools available)
- User is logged in to the target Confluence instance
- A page with an existing macro to edit

## Step 1: Enter the Page Editor

From a Confluence page view URL, navigate directly to the edit URL:

```
View:  https://<site>.atlassian.net/wiki/spaces/<SPACE>/pages/<pageId>/<title>
Edit:  https://<site>.atlassian.net/wiki/spaces/<SPACE>/pages/edit-v2/<pageId>
```

Use `browser_navigate` with the edit URL. Then wait 3 seconds for the editor to load.

**Do NOT** try to find and click an Edit button on the view page — navigating directly to the edit URL is faster and more reliable.

## Step 2: Select the Macro

Click the macro extension element to select it. Use `browser_evaluate`:

```js
() => {
  const ext = document.querySelector('.extensionView-content-wrap');
  if (ext) { ext.click(); return 'selected'; }
  return 'not found';
}
```

If there are multiple macros on the page, use `querySelectorAll` and index into the NodeList:

```js
() => {
  const exts = document.querySelectorAll('.extensionView-content-wrap');
  // Click the Nth macro (0-indexed)
  if (exts[0]) { exts[0].click(); return 'selected'; }
  return 'not found';
}
```

## Step 3: Open the Macro Editor Dialog

After selecting the macro, a floating toolbar appears. Click the Edit button:

```js
() => {
  const btn = document.querySelector('[data-testid="extension-toolbar-edit-button"]');
  if (btn) { btn.click(); return 'clicked edit'; }
  return 'edit button not found';
}
```

Wait **5 seconds** for the editor dialog and its iframe to fully load.

## Step 4: Identify the Dialog Type

The dialog structure differs between Forge and Connect apps.

### Forge (Lite) App

The modal and iframe:
- Modal: `[data-testid="custom-ui-modal-dialog"]`
- Iframe: `[data-testid="hosted-resources-iframe"]`

To interact with elements inside the iframe, use `browser_evaluate` with a ref to an element inside the iframe (obtained from a snapshot), or use this pattern:

```js
() => {
  const iframe = document.querySelector('[data-testid="hosted-resources-iframe"]');
  return !!iframe;  // true = Forge dialog
}
```

### Connect (Full) App

The modal and iframe:
- Modal: `[role="dialog"]` (an `<section>` with ARIA role, NOT a `<dialog>` element)
- Iframe: `[role="dialog"] iframe`

```js
() => {
  const dialog = document.querySelector('[role="dialog"]');
  return dialog && !document.querySelector('[data-testid="custom-ui-modal-dialog"]');  // true = Connect dialog
}
```

## Step 5: Switch Diagram Type (Optional)

Inside the editor iframe, the diagram type tabs are in a `tablist`. To switch types:

1. First, take a **snapshot** to get a ref to an element inside the iframe (the snapshot will show `f`-prefixed refs for iframe content).
2. Find the tablist ref (look for `tablist` in the snapshot YAML).
3. Use `browser_evaluate` with that ref to click the desired tab:

```js
// Use with ref pointing to the tablist element inside the iframe
(el) => {
  const tabs = el.querySelectorAll('button[role="tab"]');
  const names = [];
  for (const t of tabs) {
    const name = t.textContent.trim();
    names.push(name);
    if (name === 'PlantUML') {  // or 'Sequence', 'Mermaid'
      t.click();
      return 'switched to ' + name;
    }
  }
  return 'tab not found, available: ' + names.join(', ');
}
```

Available tab names: `Sequence`, `Mermaid`, `PlantUML`

**Why a snapshot is needed here**: The iframe is cross-origin, so we cannot directly query its DOM from the parent page. The Playwright snapshot gives us refs (`f`-prefixed) that can target elements inside the iframe.

## Step 6: Publish / Save

After making changes (switching type, editing code, etc.), click the Publish button inside the iframe:

```js
// Use with ref pointing to the tablist element (or any element inside the iframe)
(el) => {
  const btns = el.closest('body').querySelectorAll('button');
  for (const b of btns) {
    if (b.textContent.trim() === 'Publish') {
      b.click();
      return 'published';
    }
  }
  return 'Publish button not found';
}
```

Wait **5 seconds** for the dialog to close and the page editor to update.

## Step 7: Verify (Optional)

Take a screenshot after publish to verify the macro preview in the page editor:

```
browser_take_screenshot with a descriptive filename
```

## Token-Saving Tips

1. **Navigate directly to edit URL** — skip the view page entirely
2. **Use `browser_evaluate` with known selectors** — avoid snapshots for parent-page interactions (steps 2, 3)
3. **Take only ONE snapshot** — after the dialog opens, to get the iframe ref for the tablist. Reuse that ref for both switching tabs and clicking Publish.
4. **Skip screenshots unless verifying** — screenshots are expensive; only take them when you need to confirm visual state
5. **Use `browser_wait_for` with `time`** — instead of polling with repeated snapshots, wait a fixed duration (3s for editor load, 5s for dialog load)

## Quick Reference: Selector Cheat Sheet

| Element | Selector |
|---------|----------|
| Macro in editor | `.extensionView-content-wrap` |
| Edit button (floating toolbar) | `[data-testid="extension-toolbar-edit-button"]` |
| Forge modal | `[data-testid="custom-ui-modal-dialog"]` |
| Forge iframe | `[data-testid="hosted-resources-iframe"]` |
| Connect modal | `[role="dialog"]` |
| Connect iframe | `[role="dialog"] iframe` |
| Tabs (inside iframe) | `button[role="tab"]` within a `tablist` |
| Publish button (inside iframe) | `button` with text "Publish" |
| Close button (inside iframe) | `button` with text "Close" |

## Example: Full Workflow

```
1. browser_navigate → edit-v2 URL
2. browser_wait_for → 3 seconds
3. browser_evaluate → click .extensionView-content-wrap
4. browser_evaluate → click [data-testid="extension-toolbar-edit-button"]
5. browser_wait_for → 5 seconds
6. browser_snapshot → get iframe tablist ref (e.g., f15e9)
7. browser_evaluate (ref=f15e9) → click PlantUML tab
8. browser_evaluate (ref=f15e9) → click Publish button
9. browser_wait_for → 5 seconds
10. browser_take_screenshot → verify result
```

Total tool calls: 8-10 (vs 20+ with repeated snapshots)
