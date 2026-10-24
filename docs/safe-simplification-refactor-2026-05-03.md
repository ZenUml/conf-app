# Safe Simplification Refactor Report

Date: 2026-05-03
Branch: `refactor/simplify-codebase`

## Goal

Simplify the codebase with low-risk, line-reducing changes. Each change group is intentionally small and can be reverted independently.

## Summary

This refactor removes obsolete Connect-specific branches now that production is Forge-only, and collapses a few local implementation patterns that used extra temporary variables or duplicate result-handling code.

Net source change:

- `15 files changed`
- `51 insertions`
- `356 deletions`
- Net reduction: `305` lines

## Change Groups

### 1. Remove the obsolete `/attachment` Pages Function

Files:

- `functions/attachment.ts`
- `public/_routes.json`

Why:

The function depended on Connect query parameters such as `xdm_e` and `addonKey`. Forge export uses `src/export.js`, so the Pages route was no longer part of the Forge-only runtime.

What changed:

- Deleted `functions/attachment.ts`.
- Removed `/attachment` from the Cloudflare Pages function allowlist.

How to reverse:

- Restore `functions/attachment.ts`.
- Add `"/attachment"` back to `public/_routes.json`.

### 2. Remove Connect dialog-close fallback from AI Aide

File:

- `src/components/react/AiAide.jsx`

Why:

`window.AP.dialog.close()` is a Connect API and is undefined in Forge. The Forge replacement is direct bridge submission.

What changed:

- Replaced the AP/postMessage fallback chain with `@forge/bridge` `view.submit()`.

How to reverse:

- Revert only `src/components/react/AiAide.jsx`.

### 3. Use Forge context for client-domain extraction

Files:

- `src/utils/ContextParameters/ContextParameters.ts`
- `src/utils/ContextParameters/ContextParameters.spec.ts`

Why:

`xdm_e` is a Connect URL parameter. Forge already provides the Confluence site/page location through `forgeGlobal.forgeContext.siteUrl` or `forgeGlobal.forgeContext.extension.location`.

What changed:

- Removed `xdm_e` lookup from `getBaseUrl()`.
- Derived the base URL from Forge context.
- Updated the unit test to use Forge context instead of Connect query parameters.

How to reverse:

- Revert these two files together.

### 4. Collapse edit-mode detection to Forge only

File:

- `src/utils/editModeDetection.ts`

Why:

The Connect branch duplicated mode inference through `LocationTarget`, while Forge mode is now the only production path.

What changed:

- Removed `ApWrapper2` and `LocationTarget` dependencies from this utility.
- Deleted the Connect detection function.
- Kept the existing Forge return values.

How to reverse:

- Revert only `src/utils/editModeDetection.ts`.

### 5. Remove Connect fallback from DocumentList preview

File:

- `src/components/DocumentList/DocumentList.vue`

Why:

The component had a second iframe preview path for Connect. Forge has native preview components, so the branch and its providers were no longer needed.

What changed:

- Removed the fallback preview iframe.
- Removed Connect provider setup.
- Always initializes through Forge context and Forge custom content APIs.
- Always emits `save-embed`.

How to reverse:

- Revert only `src/components/DocumentList/DocumentList.vue`.

### 6. Simplify provider and feature evaluation wiring

Files:

- `src/model/ContentProvider/CompositeContentProvider.ts`
- `src/services/FeatureService.ts`

Why:

Both files had repeated local variables whose only purpose was immediate return or constructor wiring.

What changed:

- Inlined content-provider construction in the fallback provider list.
- Combined equivalent missing-feature and disabled-feature branches.
- Added one helper to centralize "record evaluation, then return result" in feature evaluation.

How to reverse:

- Revert either file independently.

### 7. Remove stale Connect comments and API stubs

Files:

- `src/model/Attachment.ts`
- `src/model/ApWrapper2.ts`
- `src/components/DrawIoExtension/ForgeEmbedEditor.vue`

Why:

The code already used Forge request helpers. The remaining Connect comments and the unused `getToken()` stub made the API surface look broader than it is.

What changed:

- Reworded attachment upload comments to Forge-only.
- Removed stale Connect wording from the internal request helper.
- Removed unused `getToken()`.
- Removed a stale Forge editor comment that referenced `AP.dialog`.

How to reverse:

- Revert each file independently.

### 8. Remove obsolete Connect-era tests and setup

Files:

- `src/model/ContentProvider/ContentProvider.spec.ts`
- `src/model/ContentProvider/ContentPropertyStorageProvider.spec.ts`
- `src/utils/isEmbedMode.spec.ts`

Why:

The deleted test file only contained setup for a mocked Connect bridge and one empty assertion. The remaining edits remove unused mock setup and a test that only asserted absence of a Connect URL parameter.

What changed:

- Deleted the empty `ContentProvider.spec.ts`.
- Removed unused `MockAp` setup from `ContentPropertyStorageProvider.spec.ts`.
- Removed the `xdm_c` source-regex assertion from `isEmbedMode.spec.ts`.

How to reverse:

- Revert each file independently.

## Verification

Commands run:

- `pnpm vitest --run src/model/ContentProvider/CompositeContentProvider.spec.ts src/model/ContentProvider/ContentPropertyStorageProvider.spec.ts src/utils/ContextParameters/ContextParameters.spec.ts src/utils/isEmbedMode.spec.ts tests/unit/connect-window-ap.spec.ts`
- `volta run --node 22.12.0 --pnpm 10.33.2 pnpm build:lite`

Results:

- Unit tests passed: `5` files, `26` tests.
- `build:lite` completed successfully.

Known verification note:

- `vue-tsc --noEmit` could not run because `vue-tsc@1.8.27` fails against the installed TypeScript package with `Search string not found: "/supportedTSExtensions = .*(?=;)/"`. This occurs before checking project source.
