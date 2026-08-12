---
name: pvt-autoconvert
description: >
  Verify and diagnose the Embed deeplink autoConvert contract in a real Confluence editor:
  pasting a /d/ URL must create the Embed macro, while typing must not. Use for focused staging or
  production checks, failing embed-deeplink-autoconvert E2E jobs, "paste did not auto convert",
  "test autoconvert", "validate deeplink paste", or suspected Confluence ProseMirror/Rovo selector
  drift. Requires Playwright because the behavior lives in Confluence's real editor.
---

# Embed deeplink autoConvert

Test the integration in the real Confluence editor. A unit or DOM-fixture test cannot prove that
Atlassian loaded and ran the Forge autoConvert matcher.

## Contract

| User action with a `/d/` URL | Expected result |
|---|---|
| Paste into the page body | An Embed macro extension node; no smart-link card |
| Type the URL and press Space | Never an Embed macro; link or plain text depends on the editor cohort |

Treat the paste leg as the release-blocking contract. Treat type-and-Space as a negative control;
Atlassian's linkification varies by account cohort (issue #430).

## Choose the target

- For a failing PR or branch pipeline, use its staging site and deployed head.
- For post-release PVT, use production and confirm the deployed build before testing.
- Infer the variant from the release/CI context. Read `tests/e2e-tests/config/apps.ts` and the
  generated variant manifest when reachability is unclear.
- Do not infer "feature absent" from a skipped test alone. Profiles and variant stripping can
  drift. In particular, the Forge wizard currently says Diagramly keeps the Embed macro while its
  E2E profile still lists `NO_EMBED`; report this inconsistency rather than inventing certainty.

Use the variant's matcher host from `tests/e2e-tests/config/test-config.ts`:

- Full: `conf-full.zenuml.com`
- Other Embed-capable variants: `conf-lite.zenuml.com`

The target content need not resolve. The matcher acts on the URL shape:

```text
https://{deeplinkHost}/d/{uuid}/{contentId}
```

## Preflight: identify the real page body

Confluence can render multiple ProseMirror editors. Rovo's prompt is also a `.ProseMirror` and may
precede the page body in DOM order.

**Never use** `.ProseMirror`, `.ProseMirror.first()`, or `document.querySelector('.ProseMirror')`
as the paste target.

Use the page body's accessible name:

```ts
const body = page.getByRole('textbox', {
  name: /Main content area|Page editing area/,
}).first();
```

Before pasting, inspect all textboxes/ProseMirror nodes and record their accessible labels. Fail
the harness setup if the page body cannot be uniquely identified. A Rovo field named "Describe or
select what you want to create" is not the page body.

## Preferred check: run the checked-in focused E2E

The repository helper is the source of truth:

- `tests/e2e-tests/helpers/embedDeeplink.ts`
- `tests/e2e-tests/tests/insert/embed-deeplink-autoconvert.spec.ts`

Example staging run:

```bash
APP=zenuml-lite@stg pnpm --dir tests/e2e-tests exec playwright test \
  tests/insert/embed-deeplink-autoconvert.spec.ts \
  --project=insert --workers=1 --reporter=line
```

Use the matching `APP` profile for another variant/environment. If the test skips, investigate the
profile and built manifest; do not report a pass.

## Interactive Playwright check

Use this when doing a spot check or when diagnosing CI. Create a disposable draft page and do not
publish it.

### 1. Clear only the page body

Click the accessible page-body textbox, then press `ControlOrMeta+a` and `Delete`. Never clear a
generic ProseMirror node.

### 2. Dispatch a real-shape paste event

Pass only `text/plain`. Dispatch the event on the focused page body itself:

```ts
const selector =
  '[role="textbox"][aria-label*="Main content area"], ' +
  '[role="textbox"][aria-label*="Page editing area"]';

await page.evaluate(({ selector, url }) => {
  const body = document.querySelector(selector) as HTMLElement | null;
  if (!body) throw new Error('Confluence page editor not found');
  body.focus();
  const dt = new DataTransfer();
  dt.setData('text/plain', url);
  body.dispatchEvent(new ClipboardEvent('paste', {
    clipboardData: dt,
    bubbles: true,
    cancelable: true,
  }));
}, { selector, url });
```

Do not add `text/uri-list`. Do not use typing as a substitute for paste.

### 3. Allow cold matcher registration

Forge matchers load asynchronously on a cold editor. Repeat the following up to 12 times:

1. Clear the page body.
2. Paste into that same body.
3. Wait about 1.5 seconds and inspect it.
4. If no Embed macro exists, wait another second and retry.

Matcher startup can leave an earlier anchor behind. Success does not require zero anchors; it
requires an Embed extension node and zero smart-link cards.

### 4. Read results only inside the page body

Never scan all `.ProseMirror` nodes. Collect:

```ts
const result = await page.evaluate((selector) => {
  const body = document.querySelector(selector);
  if (!body) throw new Error('Confluence page editor not found');
  return {
    extensionKeys: [...body.querySelectorAll('[extensionkey]')]
      .map((node) => node.getAttribute('extensionkey') || ''),
    cardCount: body.querySelectorAll(
      '[data-node-type="inlineCard"], [data-node-type="blockCard"]',
    ).length,
    anchors: [...body.querySelectorAll('a[href]')]
      .map((node) => node.getAttribute('href') || ''),
  };
}, selector);
```

**PASS** when an `extensionKey` contains `zenuml-embed-macro` and `cardCount === 0`.

Capture a screenshot or Playwright snapshot showing the macro in the page body. DOM output plus a
UI screenshot/snapshot is the evidence; a unit-test result is not UI evidence.

## Diagnose failures

| Observed evidence | Interpretation | Next action |
|---|---|---|
| URL appears in the Rovo prompt; page body is empty | Test targeted the wrong ProseMirror | Fix every click, clear, paste, and read selector to scope to the page body |
| Anchor/card appears in the page body after all retries | Paste reached the editor, but matcher did not convert | Check deployed manifest matcher host, app installation, and matcher readiness |
| Nothing appears in the page body | Paste event did not reach the intended node | Inspect focus, selector uniqueness, and `ClipboardEvent.defaultPrevented` |
| Embed exists but a global query also reports an anchor | Result reader scanned another editor or startup residue | Scope reads to the page body; do not require zero anchors |
| Checked-in test is skipped | Test profile says Embed is unreachable | Compare profile with generated manifest; skip is not a product pass |
| Typing stays plain text but paste converts | Known editor-cohort behavior | Record the negative-control result; do not block the release on linkification |

When CI fails, download the Playwright report/trace and inspect its accessibility snapshot. The
decisive signature of the 2026-08 regression was the deeplink under the active Rovo textbox while
"Page editing area" remained empty.

## Report

```text
AutoConvert check (<variant>, <environment>):
- page-body target: PASS/FAIL — accessible label observed
- paste: PASS/FAIL — Embed extension key, smart-link count
- UI evidence: screenshot/snapshot/trace reference
- type+Space negative control: PASS/FAIL/SKIPPED — cohort caveat if applicable
- diagnosis: only when failed; distinguish harness selector drift from matcher failure
```

Navigate away without publishing the disposable draft. Do not delete existing pages.
