# Forge Save Creates Orphaned Custom Content (atlas_doc_format 404)

## Symptom

When editing an existing Forge macro and clicking Publish, the diagram appears unchanged. Switching diagram type (e.g., Sequence to PlantUML) and publishing does not take effect.

## Root Cause Chain

### 1. atlas_doc_format API returns 404

The copy detection code in `AtlasPage.ts:96` fetches the page body to count macros:

```
GET /wiki/api/v2/pages/{pageId}?body-format=atlas_doc_format&get-draft=true
```

This returns **404** when the page has no active draft. The V2 API error body is explicit:

```
"Draft for page with id [pageId] not found"
```

The `get-draft=true` parameter only succeeds when someone is actively editing the page in the Confluence editor at the moment the call is made. This is **not** guaranteed when the Forge macro dialog opens — the Forge iframe's `requestConfluence` may not see the outer editor's draft session.

### 2. countMacros returns 0

When the API returns 404, `AtlasPage.macros()` catches the error and returns `[]`. This makes `countMacros()` return **0**.

### 3. saveCustomContentV2 creates new content instead of updating

In `ApWrapper2.ts:787`, the update condition requires `count === 1`:

```js
if (existing && (!pageId || (String(pageId) === String(existing?.pageId) && count === 1))) {
  result = await this.updateCustomContentV2(existing, value);  // PUT - updates in place
} else {
  result = await this.createCustomContentV2(value);  // POST - creates NEW content with new ID
}
```

With `count === 0`, the condition fails, so a **new** custom content is created (POST 201) instead of updating the existing one (PUT 200).

### 4. Macro config is not updated

In `forgeIndex.ts:296-302`, after saving:

```js
if (await isInserting()) {
  await (await getView()).submit({config: {customContentId: id, ...}});  // only for NEW macros
} else {
  await (await getView()).close();  // existing macros - does NOT update config
}
```

`view.close()` does not pass the new `customContentId` back to the macro config. The macro still points to the old custom content.

### 5. Viewer shows old diagram

The viewer loads from `customContentId` in the macro config, which still points to the original (unmodified) custom content.

## Affected Scenarios

This is **neither page-specific nor site-specific — it is parameter-specific**.

Confirmed behavior across staging (`lite-stg.atlassian.net`):

| Page type | `get-draft=true` result |
|-----------|------------------------|
| Published, active draft exists (someone editing it) | 200 |
| Published, no active draft | 404 |
| E2E test page (published, no active draft) | 404 |

**The 404 occurs on any page that has no active draft at the time the Forge iframe makes the call.** This means the macro edit flow is broken whenever the user opens the macro editor and the page's draft isn't accessible to `requestConfluence`.

## Diagnosis

### Network tab

Look for these requests during Publish:

| Request | Healthy | Broken |
|---------|---------|--------|
| `GET .../pages/{id}?body-format=atlas_doc_format&get-draft=true` | 200 | 404 |
| Custom content save | `PUT .../custom-content/{id}` (200) | `POST .../custom-content` (201) |

### Console

Look for:
- `"not content edit, skip save macro."` - Expected in Forge (AP saveMacro not used)
- `"Saving diagram to platform content provider"` - Save event fired
- `"Detected copied macro"` - Copy detection triggered (count > 1)
- No `"Found N macros on page"` log - Indicates `macros()` threw before logging

## Copy Detection Context

The `count === 1` guard was added in Dec 2021 to prevent **copy corruption**:

1. **Cross-page copy** (`fddbfbaa`): User copies macro from Page A to Page B. Both share the same `customContentId`. Without detection, editing on Page B would corrupt Page A.

2. **Same-page copy** (`1b928443`): User duplicates a macro on the same page. Two macros share one `customContentId`. Editing one would change both.

The guard intentionally creates new content when it can't confirm there's exactly one macro using the content. The `count === 0` case (API failure) is treated the same as `count > 1` (actual copy) as a safety measure.

## Potential Fixes

1. **Handle count === 0 differently**: When `count === 0` (API failure, not actual copies detected), and `pageId === existing.pageId`, trust the `isCopy` flag from load time and allow update.

2. **Remove `get-draft=true`** (recommended): The published page content is sufficient for counting macros. The copy detection use case only needs to know if the same `customContentId` appears more than once — which is already true in the published version. Risk: a macro added in the current editor session (not yet published) wouldn't be counted, but this is an edge case unlikely to cause copy corruption.

   Alternative: fall back silently — retry without `get-draft=true` when the initial call returns 404.

3. **Update macro config on new content**: When `createCustomContentV2` is used instead of update, call `view.submit({config: {customContentId: newId}})` instead of `view.close()`. This ensures the macro config always points to the correct content.

## Related Files

- `src/model/page/AtlasPage.ts:84-118` - `macros()` method, fetches page body
- `src/model/ApWrapper2.ts:774-804` - `saveCustomContentV2`, copy detection during save
- `src/model/ApWrapper2.ts:300-331` - `getCustomContentByIdV2`, copy detection during load
- `src/model/ContentProvider/CustomContentStorageProvider.ts:34-42` - `save()`, dispatches to update or create
- `src/model/ContentProvider/Persistence.ts:13-73` - `saveToPlatform`, orchestrates save flow
- `src/forgeIndex.ts:277-303` - Save event handler, `view.close()` vs `view.submit()`
