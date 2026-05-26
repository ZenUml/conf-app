# API recipes

All snippets run via `mcp__playwright__browser_evaluate` against the logged-in Confluence session.
They use `fetch()` with `credentials: 'include'` so the session cookie is sent automatically — no
API token needed.

Each snippet is self-contained: paste verbatim as the `function` argument to `browser_evaluate`.

## Inspect page state

Pulls everything you need to characterize a page's macro / CC state in one call: child CCs, their
body shape, and the macro `customContentId` references from the page storage XML.

```js
async () => {
  const pageId = 'PAGE_ID_HERE';  // replace

  // 1. Custom content children of the page
  const ccRes = await fetch(`/wiki/api/v2/pages/${pageId}/custom-content?limit=250&body-format=raw`, {
    credentials: 'include',
  });
  const ccData = await ccRes.json();
  const children = (ccData?.results || []).map(r => {
    let body = null;
    try { body = JSON.parse(r?.body?.raw?.value || '{}'); } catch {}
    return {
      ccId: r.id,
      title: r.title,
      pageId: r.pageId,
      diagramType: body?.diagramType,
      hasBodyId: !!body?.id,
      bodyId: body?.id,
    };
  });

  // 2. Macro customContentId references from the page storage XML
  const pgRes = await fetch(`/wiki/api/v2/pages/${pageId}?body-format=storage`, {
    credentials: 'include',
  });
  const pg = await pgRes.json();
  const storage = pg?.body?.storage?.value || '';
  const macroRefs = [];
  const re = /<ac:adf-parameter\s+key="custom-content-id">([^<]+)<\/ac:adf-parameter>/g;
  let m;
  while ((m = re.exec(storage)) !== null) macroRefs.push(m[1]);

  return {
    pageId,
    title: pg?.title,
    children,
    macroRefs,                              // each ref appears twice — once for extension, once for body
    distinctMacroRefs: [...new Set(macroRefs)],
  };
}
```

## Inspect a single CC

When you have a specific CC id and want to see exactly what's in its body:

```js
async () => {
  const ccId = 'CC_ID_HERE';
  const r = await fetch(`/wiki/api/v2/custom-content/${ccId}?body-format=raw`, { credentials: 'include' });
  const data = await r.json();
  let body = null;
  try { body = JSON.parse(data?.body?.raw?.value || '{}'); } catch {}
  return {
    status: r.status,
    ccId: data?.id,
    pageId: data?.pageId,
    title: data?.title,
    bodyKeys: body ? Object.keys(body) : null,
    bodyId: body?.id,
    diagramType: body?.diagramType,
    isCopy: body?.isCopy,
    isNew: body?.isNew,
  };
}
```

`status: 200` with a populated body means the CC exists. `404` means it was purged. Trashed CCs
(soft-deleted) still return `200` but with `status: "trashed"` in the response — the body is
intact and the viewer will still load it.

## Find any saved macro of a given type

Useful for Phase 1 discovery when no source page id was supplied.

```js
async () => {
  const wantedType = 'sequence';  // 'sequence' | 'graph' | 'openapi' | 'plantuml'

  const res = await fetch('/wiki/api/v2/custom-content?limit=100&body-format=raw', {
    credentials: 'include',
  });
  const data = await res.json();
  const match = (data?.results || []).find(r => {
    try { return JSON.parse(r.body.raw.value).diagramType === wantedType; } catch { return false; }
  });
  if (!match) return { found: false };
  return {
    found: true,
    ccId: match.id,
    pageId: match.pageId,
    title: match.title,
  };
}
```

The `limit=100` call only scans the first 100 CCs on the site — fine for staging where the dataset
is small. If discovery returns nothing, prefer creating a fresh source page via the `create-test-page`
skill rather than scanning further.

## Verify a page id is sane to operate on

Before any destructive step (just page deletion in this skill), sanity-check the page.

```js
async () => {
  const pageId = 'PAGE_ID_HERE';
  const r = await fetch(`/wiki/api/v2/pages/${pageId}`, { credentials: 'include' });
  const data = await r.json();
  return {
    status: r.status,
    title: data?.title,
    spaceId: data?.spaceId,
    parentId: data?.parentId,
    createdAt: data?.createdAt,
    authorId: data?.authorId,
  };
}
```

Abort if the title doesn't start with `"Copy of"` — you'd be about to delete the wrong page.

## Delete a copy page (cleanup)

Removes the page and its child custom contents in one shot. Use only on pages we just created.

```js
async () => {
  const copyPageId = 'COPY_PAGE_ID_HERE';
  const r = await fetch(`/wiki/api/v2/pages/${copyPageId}?purge=true`, {
    method: 'DELETE',
    credentials: 'include',
    headers: { 'X-Atlassian-Token': 'no-check' },
  });
  return { status: r.status };
}
```

`status: 204` is success. Anything else, leave the page in place and report the id.

## Triggering the page copy (UI, not API)

There's no V2 REST endpoint for `make-a-copy` that we trust — the Confluence platform handles the
child CC duplication only via the UI flow. So the copy step is the one part of the test that must
be driven through Playwright MCP:

1. `mcp__playwright__browser_navigate` to the source page.
2. `mcp__playwright__browser_click` on the page header's "More actions" button (the *second* visible
   match — the first is the space-sidebar item).
3. `mcp__playwright__browser_click` on the `[role="menuitem"]` containing "Make a copy".
4. `mcp__playwright__browser_click` on the dialog's "Make a copy" button.
5. The browser lands at `/wiki/spaces/<key>/pages/edit-v2/<NEW_ID>?draftShareId=…` — `<NEW_ID>` is
   the copy page id. Extract from `location.href`.
6. `mcp__playwright__browser_click` on "Publish..." in the page header.
7. `mcp__playwright__browser_click` on the dialog's "Publish" button (not "Schedule publish").

After step 7 the URL changes from `edit-v2/<NEW_ID>` to `pages/<NEW_ID>/<slug>` — the page is
published and the macros begin rendering.
