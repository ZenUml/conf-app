---
name: pvt-autoconvert
description: >
  Focused production validation for the embed-deeplink autoConvert contract: pasting a /d/ deeplink
  URL converts to the embed macro; typing the same URL does NOT convert (it linkifies or becomes a
  smart-link). Runs interactively via Playwright MCP on a real account — this is deliberately NOT a
  CI assertion (see "Why this is PVT, not CI"). Invoked by release-app Step 2.6 when
  embed/deeplink/autoconvert commits are detected. Triggers on "pvt-autoconvert",
  "test autoconvert", "validate deeplink paste".
---

# PVT — Embed deeplink autoConvert

Focused post-release validation of the #360 autoConvert contract on **production**.

## The contract being verified

| Action with a `/d/` deeplink URL | Expected result |
|---|---|
| **Paste** into the page editor | Converts to the **embed macro** extension node (no smart-link card) |
| **Type** it + Space | **NOT** the macro; Confluence's own conversion applies — a plain `<a>` anchor **or** an inline smart-link card are both acceptable |

## Why this is PVT, not CI

The type+space leg asserts **Confluence's** linkify-on-type behavior, which varies by the editor
cohort a given account is served. Measured 2026-07-31 (issue #430): the CI robot account on
`zenuml.atlassian.net` produced **0 anchors 3/3 deterministically**, while the same account on
`lite-stg` and a human account on the same prod site both linkified correctly. A hard CI gate
cannot pin behavior that Atlassian rolls out per-account. Interactive PVT on a real account is the
correct home. (The paste leg — our code — remains in CI:
`tests/e2e-tests/tests/insert/embed-deeplink-autoconvert.spec.ts`.)

## Arguments

Usage: `/pvt-autoconvert [lite] [full] [diagramly]`

Variant selection follows the other `pvt-*` skills: explicit flag > infer from the release thread >
ask. **Note variant reachability:** the embed macro is stripped from the Diagramly manifest — for a
diagramly release record `Not testable in diagramly — embed macro not in manifest` instead of
running.

Site: production `zenuml.atlassian.net`. Scratch space: **ZEN**, parent `247136259`.

## Sample URL

```
https://{deeplinkHost}/d/{uuid}/{pageId}
```

- `deeplinkHost`: `conf-full.zenuml.com` for full, `conf-lite.zenuml.com` otherwise (mirrors
  `tests/e2e-tests/config/test-config.ts`).
- Use throwaway ids (e.g. `c78e721e-957f-402c-9b70-1df2227c2739` / `170721444`) — the content does
  **not** need to resolve; the matcher acts on URL shape alone.

## Steps (Playwright MCP, real Chrome session)

Create a draft page (do NOT publish it; abandon the draft at the end):

```
browser_navigate url="https://zenuml.atlassian.net/wiki/create-content/page?spaceKey=ZEN&parentPageId=247136259"
```

### Check 1 — type + space must NOT convert (and must linkify)

Via `browser_run_code_unsafe`:

```js
async (page) => {
  await page.waitForTimeout(4000);
  await page.locator('textarea[name="editpages-title"]').fill('throwaway autoconvert probe (do not publish)');
  await page.locator('[data-testid="ak-editor-fp-content-area"]').click();
  const pm = page.locator('.ProseMirror').first();
  await pm.click();
  await page.keyboard.type('https://conf-lite.zenuml.com/d/c78e721e-957f-402c-9b70-1df2227c2739/170721444', { delay: 5 });
  await page.keyboard.press('Space');
  await page.waitForTimeout(5000);   // let any async smart-link upgrade settle
  return await pm.evaluate((el) => ({
    anchors: el.querySelectorAll('a').length,
    inlineCards: el.querySelectorAll('[data-inline-card], .inlineCardView, [data-card-url]').length,
    embedMacro: el.querySelectorAll('[extensionkey*="embed"], [data-macro-name*="embed"]').length,
  }));
}
```

**PASS**: `embedMacro === 0` AND (`anchors > 0` OR `inlineCards > 0`).
**FAIL**: `embedMacro > 0` (typing triggered the matcher — real regression) or all three are 0
(URL stayed plain text — record the editor cohort caveat and re-test on a second account before
declaring failure).

### Check 2 — paste must convert to the embed macro

Typing `Cmd+V` is not scriptable here; dispatch a synthetic paste `ClipboardEvent` on the focused
ProseMirror node — the exact mechanics live in `tests/e2e-tests/helpers/embedDeeplink.ts`
(`pasteDeeplinkUntilConverted`); mirror its event shape (`text/plain` clipboardData):

```js
async (page) => {
  const pm = page.locator('.ProseMirror').first();
  await pm.click();
  await page.keyboard.press('Enter');
  await pm.evaluate((el) => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'https://conf-lite.zenuml.com/d/c78e721e-957f-402c-9b70-1df2227c2739/170721444');
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(4000);
  return await pm.evaluate((el) => ({
    embedMacro: el.querySelectorAll('[extensionkey*="embed"], [data-macro-name*="embed"]').length,
    inlineCards: el.querySelectorAll('[data-inline-card], .inlineCardView, [data-card-url]').length,
  }));
}
```

**PASS**: `embedMacro > 0` and `inlineCards === 0`.

### Cleanup

Navigate away without publishing (the draft is abandoned; Confluence prunes it). Do not delete
existing pages.

## Report

```
PVT-autoconvert (<variant>, zenuml prod, account <who>):
- type+space: no macro ✓/✗, linkified (anchor|card) ✓/✗
- paste: embed macro ✓/✗, no smart-link card ✓/✗
```

If type+space linkify fails but paste passes, cite issue #430 (editor cohort variance) before
treating it as a release blocker.
