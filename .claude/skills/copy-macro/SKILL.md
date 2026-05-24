---
name: copy-macro
description: >
  E2E test for Confluence's "Make a copy" page action against pages that contain ZenUML macros
  (sequence, graph/DrawIO, OpenAPI). Verifies that after copy-then-edit, the macro on the new page
  correctly references a custom content owned by the new page — not the source page's customContent.
  Drives the test via Playwright MCP and the Confluence REST v2 API. Non-destructive: never purges
  custom content, only inspects state. Use when the user says "copy macro test", "test page copy",
  "verify cross-page-copy fix", "run the copy e2e", or whenever they want to validate the cross-page
  macro writeback behavior (PR #124 / ZEN-1170) on any Forge site.
---

# Copy Macro — Cross-Page-Copy E2E Test

Verify Confluence's page-copy operation against ZenUML macros end-to-end, then verify the editor's
writeback behavior on the copy. This is an **observation + edit-and-verify** test, not a destructive
reproduction — no custom content is purged.

## What this test verifies

When a Confluence user runs **More actions → Make a copy** on a page with ZenUML macros:

1. **Confluence duplicates the child custom contents** — the new page gets fresh CC ids whose body is
   cloned verbatim from the source.
2. **The macro storage XML on the copy page is NOT updated** — `<ac:adf-parameter key="custom-content-id">`
   still references the source page's CC ids. This is a Confluence platform behavior, not a ZenUML bug.
3. **The macros on the copy still render** because they cross-page-fetch the source's CCs.
4. **The first edit-and-save on the copy must writeback the new CC id** via `view.submit({config:{customContentId:…}})`
   so the macro stops pointing at the source page's content. This is the PR #124 `idChanged` behavior.

The e2e asserts (3) and (4). The intermediate state (2) is captured as evidence to make the test
easy to debug if it ever regresses.

## Why this exists

The recurring customer report is "graph macro doesn't load on a page I copied" — the underlying
cause is always step (2) (macro still points at source CC), made visible by some downstream event
(source CC deleted, restricted space, etc.). PR #124 added cross-page-copy writeback; the cherry-pick
of b91565c6 + c2792eac added an orphan-recovery probe. This test guards the writeback path so a
regression there can't ship unnoticed.

It does **not** simulate the orphan condition (we'd have to purge a CC to do that), and it does
**not** test the recovery probe. Those need a separate, destructive skill.

## Arguments

Usage: `copy-macro [on <site>] [--source-page <pageId>] [--macro-type sequence|graph|openapi]`

- **site** — `lite-stg` (default), `lite-dev`, `full-stg`, `dia-stg`, `conf-lite` (prod), `conf-full` (prod).
- **--source-page** — page id with the target macro already saved. If omitted, the skill discovers one
  via the REST API.
- **--macro-type** — which macro to exercise. Default: sequence (lowest cost — no DrawIO load).

## Site configuration

| Name | Domain | Space | Variant | Add-on key | Default parent for new pages |
|------|--------|-------|---------|-----------|------------------------------|
| `lite-stg` | `lite-stg.atlassian.net` | SD | lite-forge | `com.zenuml.confluence-addon-lite` | 524297 |
| `lite-dev` | `lite-dev.atlassian.net` | (discover) | lite-forge | `com.zenuml.confluence-addon-lite` | (discover) |
| `full-stg` | `full-stg.atlassian.net` | (discover) | full-forge | `com.zenuml.confluence-addon` | (discover) |
| `dia-stg` | `dia-stg.atlassian.net` | (discover) | diagramly | (discover) | (discover) |
| `conf-lite` | `<tenant>.atlassian.net` | (caller-supplied) | lite-forge | `com.zenuml.confluence-addon-lite` | (caller-supplied) |

For prod sites, the caller must specify both the tenant subdomain and source page id explicitly.
Never auto-discover on prod.

## Why Playwright MCP

Forge Custom UI iframes are sandboxed and cross-origin. Only Playwright MCP can drive UI inside them
(see `CLAUDE.md` § "Browser Automation and Forge Iframes"). For pure REST inspection the skill uses
`mcp__playwright__browser_evaluate` to run `fetch()` from inside the logged-in browser session —
that avoids re-authenticating with API tokens.

## The flow

### Phase 1 — Identify a source page (read-only)

If `--source-page` was supplied, jump to Phase 2. Otherwise, discover one.

```js
// List a few recent custom contents and pick the first one matching the requested diagramType.
async () => {
  const res = await fetch('/wiki/api/v2/custom-content?limit=50&body-format=raw', { credentials: 'include' });
  const data = await res.json();
  const match = data.results.find(r => {
    try { return JSON.parse(r.body.raw.value).diagramType === 'sequence'; } catch { return false; }
  });
  return match ? { ccId: match.id, pageId: match.pageId, title: match.title } : null;
}
```

If nothing matches, fall back to `create-test-page` skill to create a source page with the target
macro type. (Cross-skill dependency — see `references/api-recipes.md` for the create snippet.)

### Phase 2 — Capture source state

Capture as evidence: source page id, the macros on it, the CC ids each macro references, and the
`body.id` field of each source CC. The `body.id` matters because it tells us whether the source CC
has ever been edited (only edits write `body.id`; fresh creates leave it unset — see
`references/data-model.md`).

Use the snippet in `references/api-recipes.md` § "Inspect page state".

### Phase 3 — Make the copy

Navigate to the source page, drive the UI:

1. Click "More actions" in the page header (second visible match — the first is the sidebar).
2. Click "Make a copy" in the menu.
3. In the resulting dialog, click "Make a copy" again (the parent + space defaults are fine).
4. The user lands on a new draft. Click "Publish..." then the "Publish" confirmation in the dialog.

The new page id appears in `location.href` after publish. Capture it.

### Phase 4 — Capture copy state (before edit)

Same inspection as Phase 2 but on the copy page. Two assertions:

- **A1**: The copy page has its own child CCs (`pageId` matches the copy). One per source macro.
- **A2**: The macro config in `body.storage.value` references the **source** CC ids — NOT the copy's
  CC ids. (This is the Confluence-platform behavior; the test captures it as evidence, not as a fail.)

If A1 fails the test cannot proceed — the platform's behavior changed and the skill needs review.

### Phase 5 — Edit the macro on the copy + publish

This is where the writeback fix is exercised:

1. Navigate to the copy page in **edit mode** (`/wiki/spaces/<key>/pages/edit-v2/<copyPageId>`).
2. Locate the macro in the editor (matched by `extensionkey` containing `zenuml-sequence-macro-lite`
   for sequence, `zenuml-graph-macro-lite` for graph, `zenuml-openapi-macro-lite` for openapi).
3. Click the macro's inner "Edit" button (visible via `browser_snapshot` — it's inside the macro's
   iframe at depth ~10).
4. Inside the Lite-paywall modal, click "Continue editing without upgrading" if it appears (Lite
   environments only). On Full / Diagramly variants this modal does not exist.
5. Click "Publish" in the macro editor header.
6. Wait for the modal to close (~5s).
7. Back on the page editor, click the page's "Publish..." button, then the dialog confirmation.

The save path is: `saveToPlatform(diagram)` → `saveCustomContentV2`. Because the loaded diagram has
`isCopy: true` (cross-page-copy detection in `ApWrapper2.getCustomContentByIdV2`), the save creates
a **new** CC instead of updating the source's. Then `forgeIndex.ts`'s save handler computes
`idChanged = sourceId !== id` and calls `view.submit({config:{customContentId: id, …}})`, which is
what we're testing.

### Phase 6 — Capture final state and assert

Inspect the copy page again. Critical assertions:

- **A3 (the headline assertion)**: The macro storage XML on the copy now references a CC id that
  matches a child CC of the copy page itself. The macro is no longer pointing at the source.
- **A4**: The new CC's `pageId` equals the copy page id (proves it's a fresh record, not an update
  to the source).
- **A5**: The new CC's body has `body.id` set to the **source CC id** (not its own id). This is
  the lineage anchor the orphan-recovery probe needs — if the source CC is ever deleted, the probe
  on the copy page walks children looking for `body.id === sourceId` and finds this CC. The save
  path serializes the loaded `diagram.id` (= source id) verbatim into the body, which is the
  intended behavior. **An A5 result of `body.id === newCcId` is a bug** — it would break the
  recovery probe by erasing the lineage.
- **A6**: The macro renders on the copy page after reload (iframe height > 100px).

If any of A3 / A4 / A5 fails, the writeback fix has regressed. Report which assertion failed,
include the captured ids from Phase 2 and Phase 4 so the reviewer can see the full state delta.

### Phase 7 — Cleanup

**Do not purge any custom content.** This skill is non-destructive.

Delete the copy page (the draft + published version) via:

```js
await fetch(`/wiki/api/v2/pages/${copyPageId}?purge=true`, {
  method: 'DELETE', credentials: 'include',
  headers: { 'X-Atlassian-Token': 'no-check' },
});
```

This removes the copy and its child CCs in one shot (page-children are deleted with the page).
The source page is untouched.

If page deletion fails (permission, parent moved), leave the copy in place and report its id so the
operator can clean it up. Never escalate to deleting individual CCs.

## Output format

Report:

```
copy-macro e2e on <site>

Source: page <sourcePageId> "<title>"
  macros: <list of {diagramType, ccId, hasBodyId}>

Copy:   page <copyPageId> "<copy title>"
  before edit:
    children: <list of {ccId, diagramType}>
    macro refs in storage: <list of {ccId}>  ← still source's ids
  after edit + save:
    children: <list of {ccId, diagramType}>
    macro refs in storage: <list of {ccId}>  ← NEW ids written back
    body.id on edited CC: <id>

Assertions:
  A1 child CCs created on copy:                PASS / FAIL
  A2 pre-edit refs point at source:            PASS / FAIL  (evidence)
  A3 post-edit macro refs new CC on copy:      PASS / FAIL  ← headline
  A4 new CC pageId matches copy page:          PASS / FAIL
  A5 new CC body.id set to its own id:         PASS / FAIL
  A6 macro renders after reload:               PASS / FAIL

Cleanup: copy page deleted.
```

If any headline assertion fails, prefix the run with `REGRESSION` and link to PR #124 / ZEN-1170.

## Safety rules

- **Never purge a custom content.** Only the copy *page* may be deleted, and only after the
  assertions are recorded.
- **Never run on a production site without explicit `--source-page` and operator confirmation.**
  Automatic discovery on prod is forbidden.
- **Do not edit a macro on the source page.** Only on the copy. Editing the source would change its
  state and break the test's "before" picture for the next run.
- If the source page has hundreds of CCs, abort — the listing endpoint caps at 250 and the test
  needs a tractable child set to inspect.

## Reference files

- `references/api-recipes.md` — All the JS snippets to paste into `browser_evaluate`. Page listing,
  CC body inspection, storage-XML macro-ref extraction.
- `references/data-model.md` — Why `body.id` matters, when it's set, what the macro storage XML
  looks like, and how `customContentId` flows through `view.submit`.
