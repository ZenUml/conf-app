---
name: check-version
description: >
  Read the deployed version label from a live Forge macro iframe on any Confluence page.
  Covers enabling zenumlDebug in the correct (iframe) storage origin, reloading, and
  extracting the version string. Use after a release, in a spot check, or in PVT to
  confirm the expected tag is live.
---

# Check Version

Reads the deployed version label (`v2026.MM.DDHHmm-{variant}`) from the Forge iframe
debug toolbar to confirm which build is running.

## Critical: zenumlDebug must be set in the iframe's own localStorage

**Wrong approach (fails silently):**
```js
// ❌ This sets the flag on the Confluence page origin — the iframe never sees it.
await page.evaluate(() => localStorage.setItem('zenumlDebug', 'true'));
```

**Correct approach:**
```js
// ✅ Use page.frames() to get the actual Frame object, then evaluate inside it.
const frames = page.frames();
const appFrames = frames.filter(f => f.url().includes(APP_CDN_FRAGMENT));
for (const frame of appFrames) {
  await frame.evaluate(() => localStorage.setItem('zenumlDebug', 'true'));
}
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5000); // let Forge init finish
```

`page.frames()` returns real `Frame` objects whose `.evaluate()` runs inside the
cross-origin iframe context. `page.locator(...).contentFrame()` returns a
`FrameLocator`, which does **not** expose `.evaluate()` — calling it throws
`frame.evaluate is not a function`.

## App CDN URL fragments

| Variant | Fragment to match |
|---------|------------------|
| Lite / Full | `01ede8b1` (shared app ID) — confirm by checking `forge list` or the iframe src |
| Diagramly | `01ede8b1` (same app deployed as a separate Forge app) |
| Other (sidebar etc.) | Different UUID — ignore these |

The iframe URL pattern is:
`https://<hash>.cdn.prod.atlassian-dev.net/<app-id>/...`

Filter by the **app-ID segment** (8-char hex after the last `/` before the path), not by
the hash prefix (which rotates with each deploy).

## Step-by-step

```js
async (page) => {
  // 1. Navigate to the page with the macro (or already there)
  // await page.goto('https://{site}/wiki/spaces/{SPACE}/pages/{pageId}/...');
  // await page.waitForTimeout(3000);

  // 2. Set zenumlDebug in every app frame
  const APP_ID = '01ede8b1'; // confirm from page.frames() URL list if unsure
  const appFrames = page.frames().filter(f => f.url().includes(APP_ID));
  for (const frame of appFrames) {
    await frame.evaluate(() => localStorage.setItem('zenumlDebug', 'true'));
  }

  // 3. Reload so the iframe picks up the flag
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(6000);

  // 4. Extract version text from the refreshed frames
  const freshFrames = page.frames().filter(f => f.url().includes(APP_ID));
  const versions = [];
  for (const frame of freshFrames) {
    const ver = await frame.evaluate(() => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        if (/v\d{4}\./.test(node.textContent)) return node.textContent.trim();
      }
      return null;
    });
    if (ver) versions.push(ver);
  }
  return versions;
}
```

## What to verify

- Version string matches the expected release tag (e.g. `v2026.06.040557…`).
- The truncated `…` suffix is normal — the full string lives in the DOM but the
  visible label is clipped by CSS. The leading `v2026.MM.DD` is enough to confirm
  the date; the HHMM part confirms the specific build within a day.
- If **no version text is found**: the iframe hasn't initialized yet (increase
  `waitForTimeout`), or `zenumlDebug` wasn't set before the reload (check that
  `appFrames` wasn't empty).

## Diagnosing a blank `appFrames`

If `page.frames().filter(f => f.url().includes(APP_ID))` returns nothing, the macro
iframe hasn't loaded yet. Common causes:

1. Navigated before the macro was rendered — add more `waitForTimeout` after `goto`.
2. Wrong APP_ID — print `page.frames().map(f => f.url())` to find the right fragment.
3. Cross-origin frame not yet attached — wait for `[data-testid="ForgeExtensionContainer"]`
   to be visible before scanning frames.

## Related skills

- **spot-check** — general post-deploy verification harness
- **pvt** — runs `/smoke-test` for each variant; check-version is a sub-step
- **release-app** — Step 2.5 (PVT) and Step 2.6 (spot check) both use version confirmation
