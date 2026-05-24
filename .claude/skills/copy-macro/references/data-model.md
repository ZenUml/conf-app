# Data model

Understanding what flows where during a page copy. Read this if an assertion fails and you need
to figure out why.

## The three identities

A ZenUML macro on a Confluence page links three distinct identities:

1. **The custom-content (CC) record** — `id`, owned by a `pageId`, holds the diagram body as a JSON
   string. Lives under `/wiki/api/v2/custom-content/{id}`.
2. **The macro's storage XML reference** — `<ac:adf-parameter key="custom-content-id">…</ac:adf-parameter>`
   embedded in the page's `body.storage.value`. This is what the renderer reads to know which CC to
   fetch.
3. **The diagram body's `id` field** — `body.id` inside the JSON stored in `body.raw.value` of the
   CC. Used **only** by the orphan recovery probe to match siblings on a page when the macro's
   referenced CC has gone missing.

In the happy path all three are consistent. The cross-page-copy bug is that (2) drifts from (1) on
a page copy.

## What `body.id` is, and when it's set

The Diagram object stored in `body.raw.value` is what the editor serializes when it saves. The
`id` field is **not** intentionally written during a fresh create — it's only set as a side-effect
of the load-then-save cycle:

| Event | Code path | `body.id` written? |
|---|---|---|
| Fresh create (`createCustomContentV2`) | `JSON.stringify(content)` where `content` is the in-memory diagram with no `id` yet | **No** |
| Load (`getCustomContentByIdV2`) | Sets `diagram.id = id` on the in-memory object only — does not persist | n/a |
| Edit + save (`updateCustomContentV2`) | `JSON.stringify(newBody)` where `newBody` is the loaded diagram, now with `id` set from the previous step | **Yes** |

So a CC that was created and never edited has no `body.id`. A CC that was edited at least once does.
This has been the behavior since the initial public release (`9aede967`) — not a recent regression,
just an opportunistic consequence of how the load-save cycle propagates state.

## What happens during page copy

Confluence's `Make a copy` operation does the following to the source page's macros:

1. **Duplicates each child custom content.** Every CC owned by `sourcePageId` is cloned to a new id
   owned by `copyPageId`. The body is copied **verbatim** as bytes — including `body.id` if the
   source had it.
2. **Copies the page body storage XML verbatim** — including the `<ac:adf-parameter key="custom-content-id">`
   values that reference the source's CC ids.

After the copy, the picture is:

```
sourcePage (id: S)
├─ source CC (id: SCC, body.id ∈ {SCC, undefined}, pageId: S)
│   ← macro on source page references SCC

copyPage (id: C)
├─ duplicated CC (id: DCC, body cloned verbatim, pageId: C)
│   ← unreferenced (orphan-by-design) until first edit
└─ macro storage XML references SCC ← drift
```

The macro on the copy page still works because it cross-page-fetches SCC. But the duplicated CC
(`DCC`) sits orphaned: it has the right content, the right `pageId`, the right body cloned from the
source — yet no macro points at it.

## How the editor save path resolves the drift (PR #124)

When the user opens the macro on the copy page and edits it, the load goes through
`getCustomContentByIdV2(SCC)` — which detects `isCrossPageCopy` because `customContent.pageId !== currentPageId`
and sets `diagram.isCopy = true`.

On save, `CustomContentStorageProvider.save` checks:

```ts
if (diagram?.source === 'custom-content' && diagram?.id && !diagram?.isCopy) {
  // in-place update
} else {
  // create a new CC
}
```

Since `isCopy === true`, the save **creates a new CC** (let's call it `NCC`) owned by the copy page.
But on its own that's not enough — the macro storage XML on the copy page still references `SCC`.

The fix in `forgeIndex.ts`'s `save` handler is the `idChanged` writeback:

```ts
const sourceId = window.diagram?.id ? String(window.diagram.id) : '';
const id = await saveToPlatform(window.diagram);
// ...
const idChanged = !!sourceId && !!id && id !== sourceId;
const needsWriteback = (await isInserting()) || idChanged || macroNeedsRepair;
if (needsWriteback) {
  await (await getView()).submit({config: {customContentId: id, ...}});
}
```

When `sourceId (= SCC) !== id (= NCC)`, the save calls `view.submit({config: {customContentId: NCC}})`,
which rewrites the macro's storage-XML reference from `SCC` to `NCC`. After this, the macro on
the copy page references the copy-page-owned CC and the drift is gone.

## Why `body.id` matters for the recovery probe (ZEN-1170)

If the source CC `SCC` is ever deleted, restricted, or otherwise becomes inaccessible, the macro
on the copy still references it, so the renderer 404s. The recovery probe (`loadCustomContentWithOrphanRecovery`)
walks the copy page's children looking for a CC whose `body.id === SCC` — the duplicated CC `DCC`
will match, *if* the source `SCC` had a `body.id` at copy time (i.e. was previously edited).

If `SCC` was never edited, the probe has nothing to match on (`DCC.body.id` is undefined). That's
the case-(b) gap surfaced in Mixpanel: `recoverable: false` with `candidate_count: 0` despite
`page_children_total > 0`.

This skill does **not** test the recovery probe. It only verifies that the writeback (case (4) at
the top) works, so the orphan condition shouldn't arise from a normal copy-then-edit flow.

## What the test's "before" and "after" should look like

A passing run produces evidence like this:

**Before edit (Phase 4):**

```
copyPage 80609281
  children:
    DCC1 (id=80609311, diagramType=plantuml, pageId=80609281)
    DCC2 (id=80609313, diagramType=sequence, pageId=80609281, body.id=557058)  ← cloned from source
    DCC3 (id=80609315, diagramType=OpenAPI, pageId=80609281)
  macro storage refs: [557058, 491523, 622593, 589832]                  ← source's CC ids
```

**After edit + save (Phase 6):**

```
copyPage 80609281
  children:
    DCC1 (unchanged)
    DCC2 (id=80609313, body.id=557058)
    NCC  (id=80609400, diagramType=sequence, pageId=80609281,
          body.id=557058,           ← preserves SOURCE id as lineage / recovery anchor
          isCopy=true, copyReason="cross-page")
    DCC3 (unchanged)
  macro storage refs: [80609400, 491523, 622593, 589832]   ← sequence ref updated
```

Two things to note about `NCC`:

1. **`body.id` keeps the source's id**, not its own. The save path goes through
   `getCustomContentByIdV2(sourceId)` → `diagram.id = sourceId`; the cross-page-copy detection
   sets `diagram.isCopy = true`; on save the diagram is JSON-stringified into the new CC's body,
   including the `id` field. This is intentional — it's the lineage anchor the recovery probe
   uses if the source ever 404s.
2. **`isCopy` and `copyReason` flags are persisted into the body.** They're not stripped on this
   save path (only the recovered-orphan save path strips them — see c2792eac). On next load
   `getCustomContentByIdV2` re-derives `isCopy` from `pageId` comparison anyway, so the stored
   flag is shadowed, but it's noisy data. A future cleanup could strip these flags on cross-page
   saves the same way c2792eac strips them on recovered-orphan saves.

The headline assertion (A3) is that the edited macro's storage ref now points at a CC whose
`pageId` equals the copy page id. Walking through the diff `557058 → 80609400` is what proves the
writeback fired.
