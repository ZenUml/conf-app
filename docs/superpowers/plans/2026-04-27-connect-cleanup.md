# Connect-era Code Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all live Connect-runtime residue from `src/` so the pure-Forge codebase no longer contains dead code paths, illegal `AP.*` calls, or vestigial Connect URL parameters.

**Architecture:** Three independent cleanups — (1) delete dead components and the legacy `upgrade.ts` they import; (2) drop vestigial `?xdm_e=...` query params from live API calls where the backend ignores them; (3) replace defensive `window.AP?.resize()` calls with the supported Forge-bridge `view.resize()`. The two `xdm_e` reads in `ContextParameters.ts` and one backend reader in `attachment.ts` stay, and `manifest.yml`'s `connect:` block stays per CLAUDE.md.

**Tech Stack:** Vue 3, TypeScript, Vitest, `@forge/bridge` (`view.resize`).

---

## Pre-flight investigation summary

**Dead (no live importer):**
| File | Imported by |
|------|-------------|
| `src/utils/upgrade.ts` | only `DashboardDocumentList.vue` and `ForgeDashboardDocumentList.vue` |
| `src/components/DocumentList/DashboardDocumentList.vue` | nothing |
| `src/components/DocumentList/ForgeDashboardDocumentList.vue` | nothing |

**Live `xdm_e` URL params (backend doesn't read them):**
- `src/services/GenerateService.ts` lines 19, 44, 52 → endpoints `/diagramly/generate`, `/diagramly/chat`, `/diagramly/fix-diagram`. Verified: `grep -rn xdm_e functions/` returns only `functions/attachment.ts` (not these endpoints).

**Live defensive `AP.*` calls:**
- `src/forgeIndex.ts:193` — `window.AP?.resize()`
- `src/components/Viewer/ViewResizer.vue:67` — `window.AP?.resize?.("100%", scaledHeight + 50)`

**Live `xdm_c` read:**
- `src/components/Viewer/GenericViewer.vue:201` — embed-channel detection

**Stays (per CLAUDE.md policy):**
- `src/utils/ContextParameters/ContextParameters.ts:10` — the one place `xdm_e` is allowed (it's the central context extractor)
- `manifest.yml:24` — `connect:` block (Atlassian migration requirement)
- `functions/attachment.ts:10` — backend `xdm_e` read (separate concern, not pure-Forge frontend)

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `src/utils/upgrade.ts` | Delete | Dead — only used by dead components |
| `src/utils/upgrade.spec.ts` | Delete (if exists) | Tests for dead module |
| `src/components/DocumentList/DashboardDocumentList.vue` | Delete | Not mounted anywhere |
| `src/components/DocumentList/ForgeDashboardDocumentList.vue` | Delete | Not mounted anywhere |
| `src/services/GenerateService.ts` | Modify | Drop `xdm_e` and `addonKey` query params from 3 fetches |
| `src/forgeIndex.ts` | Modify | Replace `window.AP?.resize()` with `view.resize()` |
| `src/components/Viewer/ViewResizer.vue` | Modify | Replace `window.AP?.resize?.()` with `view.resize()` |
| `src/components/Viewer/GenericViewer.vue` | Modify | Replace `xdm_c` embed detection with Forge moduleKey check |
| `tests/unit/services/GenerateService.spec.ts` | Create or update | Assert URLs no longer contain `xdm_e` |
| `tests/unit/components/Viewer/ViewResizer.spec.ts` | Create or update | Assert `view.resize` called instead of `AP.resize` |

---

## Task 1: Delete the dead upgrade flow

**Files:**
- Delete: `src/utils/upgrade.ts`
- Delete: `src/utils/upgrade.spec.ts` (if it exists)
- Delete: `src/components/DocumentList/DashboardDocumentList.vue`
- Delete: `src/components/DocumentList/ForgeDashboardDocumentList.vue`

- [ ] **Step 1: Re-confirm nothing imports these files**

```bash
grep -rn "from ['\"]@/utils/upgrade['\"]\|from ['\"].*DashboardDocumentList['\"]" src/ tests/ --include="*.ts" --include="*.vue"
```

Expected output: only the two DocumentList Vue files importing `@/utils/upgrade` (which we are deleting in this task). If anything else appears, STOP and add a Task 0 to migrate that caller first.

- [ ] **Step 2: Delete the four files**

```bash
git rm src/utils/upgrade.ts \
       src/components/DocumentList/DashboardDocumentList.vue \
       src/components/DocumentList/ForgeDashboardDocumentList.vue
# Delete spec only if it exists:
[ -f src/utils/upgrade.spec.ts ] && git rm src/utils/upgrade.spec.ts
```

- [ ] **Step 3: Run unit tests to confirm no breakage**

```bash
pnpm test:unit
```

Expected: PASS (309+ tests, no failures). If any test imports the deleted files, the runner will surface it — fix or delete those tests as part of this task.

- [ ] **Step 4: Run a build to confirm no static-import breakage**

```bash
pnpm build:lite
```

Expected: build succeeds. If a build error mentions `@/utils/upgrade` or `DashboardDocumentList`, a router or registry referenced these and Step 1 missed it — go fix the caller.

- [ ] **Step 5: Commit**

```bash
git commit -m "chore(connect): delete dead upgrade.ts and DocumentList components"
```

---

## Task 2: Drop vestigial `xdm_e` and `addonKey` from GenerateService URLs

**Files:**
- Modify: `src/services/GenerateService.ts`
- Create or update: `tests/unit/services/GenerateService.spec.ts`

The backend handlers for `/diagramly/generate`, `/diagramly/chat`, and `/diagramly/fix-diagram` do not read these params (verified: `grep -rn xdm_e functions/` shows only `functions/attachment.ts`). They're dead URL noise carried over from Connect.

- [ ] **Step 1: Find the test file (or confirm it doesn't exist)**

```bash
ls tests/unit/services/GenerateService.spec.ts 2>/dev/null || echo "does-not-exist"
```

- [ ] **Step 2: Write a failing test asserting the URL has no `xdm_e`**

If the spec file does not exist, create `tests/unit/services/GenerateService.spec.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { generateDiagramFromPage, fixDiagram, chat } from '@/services/GenerateService'

vi.mock('@/utils/window', () => ({
  callRemote: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
}))

import { callRemote } from '@/utils/window'

describe('GenerateService URLs are Forge-clean (no xdm_e, no addonKey)', () => {
  beforeEach(() => {
    vi.mocked(callRemote).mockClear()
  })

  it('generateDiagramFromPage does not include xdm_e or addonKey query params', async () => {
    await generateDiagramFromPage('test page', 'sequence').catch(() => {})
    const url = vi.mocked(callRemote).mock.calls[0][0] as string
    expect(url).not.toContain('xdm_e')
    expect(url).not.toContain('addonKey')
  })

  it('fixDiagram does not include xdm_e or addonKey query params', async () => {
    await fixDiagram('content', 'error').catch(() => {})
    const url = vi.mocked(callRemote).mock.calls[0][0] as string
    expect(url).not.toContain('xdm_e')
    expect(url).not.toContain('addonKey')
  })

  it('chat does not include xdm_e or addonKey query params', async () => {
    await chat('hello', []).catch(() => {})
    const url = vi.mocked(callRemote).mock.calls[0][0] as string
    expect(url).not.toContain('xdm_e')
    expect(url).not.toContain('addonKey')
  })
})
```

If the spec file already exists, append the three `it(...)` blocks above into the existing `describe(...)` (or wrap them in a new `describe`).

- [ ] **Step 3: Run the new tests — they must fail**

```bash
pnpm test:unit -- GenerateService
```

Expected: FAIL with "Expected URL not to contain xdm_e".

- [ ] **Step 4: Update `src/services/GenerateService.ts` to drop the params**

For each of the three call sites (lines 19, 44, 52), change:

```typescript
const response = await callRemote(`/diagramly/generate?xdm_e=${getBaseUrl()}&addonKey=${addonKey()}`, 'POST', { ... })
```

To:

```typescript
const response = await callRemote(`/diagramly/generate`, 'POST', { ... })
```

Apply the same transformation to `/diagramly/chat` (line 44) and `/diagramly/fix-diagram` (line 52). Remove now-unused imports of `getBaseUrl` and `addonKey` if they become orphans (run `pnpm lint:vue` or rely on tsc unused-locals to flag them).

- [ ] **Step 5: Run tests — must pass**

```bash
pnpm test:unit -- GenerateService
```

Expected: PASS.

- [ ] **Step 6: Run full unit suite**

```bash
pnpm test:unit
```

Expected: PASS (no regressions).

- [ ] **Step 7: Commit**

```bash
git commit -m "chore(connect): drop vestigial xdm_e/addonKey from GenerateService URLs"
```

---

## Task 3: Replace defensive `window.AP?.resize()` with `view.resize()`

**Files:**
- Modify: `src/forgeIndex.ts:193`
- Modify: `src/components/Viewer/ViewResizer.vue:67`
- Update: `tests/unit/components/Viewer/ViewResizer.spec.ts` (if exists)

`@forge/bridge` exports `view.resize(width, height)` — the supported Forge-runtime equivalent of `AP.resize`. Both call sites use defensive optional chaining today, so they silently no-op in pure Forge.

- [ ] **Step 1: Confirm Forge bridge is already imported in both files**

```bash
grep -n "from ['\"]@forge/bridge['\"]" src/forgeIndex.ts src/components/Viewer/ViewResizer.vue
```

If `view` isn't imported, add `import { view } from '@forge/bridge'` to the affected file in Step 3.

- [ ] **Step 2: Find or create the ViewResizer spec**

```bash
ls tests/unit/components/Viewer/ViewResizer.spec.ts 2>/dev/null || \
  ls src/components/Viewer/ViewResizer.spec.ts 2>/dev/null || echo "does-not-exist"
```

- [ ] **Step 3: Add a failing test asserting `view.resize` is called**

If no spec exists, create `tests/unit/components/Viewer/ViewResizer.spec.ts`:

```typescript
import { mount } from '@vue/test-utils'
import { describe, it, expect, vi } from 'vitest'
import ViewResizer from '@/components/Viewer/ViewResizer.vue'

const resizeMock = vi.fn()
vi.mock('@forge/bridge', () => ({
  view: { resize: resizeMock },
}))

describe('ViewResizer', () => {
  it('calls view.resize from @forge/bridge instead of window.AP.resize', async () => {
    // Mount with a child element and trigger the resize observer entry
    const wrapper = mount(ViewResizer, {
      slots: { default: '<div style="height:200px">child</div>' },
    })
    // Wait for the next tick so any post-mount effects fire
    await wrapper.vm.$nextTick()
    // The component is expected to call view.resize at least once
    // (or after a simulated content change — adjust below to match the actual API)
    expect(resizeMock).toHaveBeenCalled()
  })
})
```

If the test details depend on internal trigger logic (ResizeObserver, etc.), inspect `ViewResizer.vue` and adjust the mount/trigger to match. The assertion is the load-bearing part: `view.resize` must be called.

- [ ] **Step 4: Run the test — must fail**

```bash
pnpm test:unit -- ViewResizer
```

Expected: FAIL because the implementation still uses `window.AP?.resize?.()`.

- [ ] **Step 5: Update `src/components/Viewer/ViewResizer.vue:67`**

Add at the top of the `<script>` block (if not already imported):

```typescript
import { view } from '@forge/bridge'
```

Replace line 67:

```typescript
window.AP?.resize?.("100%", scaledHeight + 50);
```

With:

```typescript
view.resize("100%", String(scaledHeight + 50));
```

Note: `@forge/bridge`'s `view.resize` signature accepts strings; double-check the API by looking at the existing `view.*` usage in the codebase (`grep -rn 'view\.' src/`) and match the calling convention.

- [ ] **Step 6: Update `src/forgeIndex.ts:193`**

Add at the top (if not already imported):

```typescript
import { view } from '@forge/bridge'
```

Replace:

```typescript
window.AP?.resize();
```

With:

```typescript
view.resize();
```

(Or whatever the no-arg convention turns out to be — check the bridge docs/types in `node_modules/@forge/bridge` if `view.resize()` zero-args isn't supported; it may need explicit dimensions.)

- [ ] **Step 7: Run tests — must pass**

```bash
pnpm test:unit
```

Expected: PASS.

- [ ] **Step 8: Build to confirm no type errors**

```bash
pnpm build:lite
```

Expected: build succeeds.

- [ ] **Step 9: Commit**

```bash
git commit -m "chore(connect): use Forge view.resize instead of window.AP.resize"
```

---

## Task 4: Replace `xdm_c` embed detection with Forge moduleKey check

**Files:**
- Modify: `src/components/Viewer/GenericViewer.vue:201`
- Update tests for that file

Current code:

```typescript
return getUrlParam('xdm_c')?.includes('channel-com.zenuml.confluence-addon__zenuml-embed');
```

This relies on Connect's xdm channel naming. In Forge, the equivalent is the module key, available via `view.getContext()` — `context.moduleKey` matches the Forge module ID (`zenuml-embed`, `zenuml-sequence-macro`, etc.).

- [ ] **Step 1: Find Forge module IDs for embed**

```bash
grep -A1 -B1 "zenuml-embed\|embed:" manifest.yml | head -30
```

This shows the Forge module key(s) that correspond to the embed entry point. Note them — you'll match against these in Step 4.

- [ ] **Step 2: Locate the existing GenericViewer test for this method**

```bash
grep -rn "xdm_c\|isEmbed\|isInEmbed" tests/unit/components/Viewer/ src/components/Viewer/*.spec.* 2>/dev/null | head -10
```

- [ ] **Step 3: Write or update a test that mocks Forge context and asserts the embed check**

```typescript
// In tests/unit/components/Viewer/GenericViewer.spec.ts (or wherever the existing spec lives)
import { vi } from 'vitest'

vi.mock('@/model/globals/forgeGlobal', () => ({
  forgeContext: { moduleKey: 'zenuml-embed' },
}))

it('detects embed mode via Forge moduleKey, not xdm_c', () => {
  // mount the component and assert the computed/method returns true
  // ...
})
```

Adjust the import path to match the actual `forgeGlobal` location in this codebase (`grep -rn "forgeContext" src/model/globals/`).

- [ ] **Step 4: Run the test — must fail**

```bash
pnpm test:unit -- GenericViewer
```

Expected: FAIL.

- [ ] **Step 5: Update `src/components/Viewer/GenericViewer.vue:201`**

Replace:

```typescript
return getUrlParam('xdm_c')?.includes('channel-com.zenuml.confluence-addon__zenuml-embed');
```

With (adjust to the actual moduleKey from Step 1):

```typescript
return forgeContext?.moduleKey === 'zenuml-embed';
```

Add the import if it's not already present:

```typescript
import { forgeContext } from '@/model/globals/forgeGlobal';
```

(Use the actual path from Step 3's investigation.)

- [ ] **Step 6: Run tests — must pass**

```bash
pnpm test:unit -- GenericViewer
```

Expected: PASS.

- [ ] **Step 7: Run full unit suite + build**

```bash
pnpm test:unit && pnpm build:lite
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git commit -m "chore(connect): detect embed mode via Forge moduleKey instead of xdm_c"
```

---

## Task 5: Tighten the CLAUDE.md policy to forbid live `AP.*` use

**Files:**
- Modify: `CLAUDE.md` (the "Pure Forge — no Connect code" section)

Add an explicit prohibition for `AP.*` references in `src/`, since the audit showed they survive as defensive-but-dead `window.AP?.foo()` calls and easily slip past review.

- [ ] **Step 1: Edit CLAUDE.md**

Find the bullet list under "Policy for all code changes" and add this bullet immediately after the existing `xdm_e / xdm_c` bullet:

```markdown
- **`AP.*` and `window.AP.*` are forbidden in `src/`** (excluding `manifest.yml`). They will be `undefined` at runtime in pure Forge — defensive optional chaining (`window.AP?.x()`) just makes the code silently no-op. Use the equivalent `@forge/bridge` API: `view.resize()` for `AP.resize`, `view.submit()` for `AP.dialog.close()`, `router.navigate()` for `AP.navigator.go()`, `requestConfluence()` for `AP.request()`, `view.getContext()` for `AP.context.getContext()`.
```

- [ ] **Step 2: Verify the section reads cleanly**

```bash
sed -n '/^## Pure Forge/,/^##/p' CLAUDE.md
```

Confirm the added bullet appears in the right place and the rendered Markdown still parses (preview in your editor or via `glow CLAUDE.md`).

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: forbid AP.* in src/ — list Forge-bridge equivalents"
```

---

## Final verification

- [ ] Run the full local validation:

```bash
pnpm test:unit && pnpm build:lite && pnpm build:full
```

- [ ] Re-grep for residue:

```bash
grep -rn "xdm_e\|xdm_c\|\\bAP\\.\\|window\\.AP\\b" src/ --include="*.ts" --include="*.vue" | grep -v "ContextParameters/ContextParameters.ts" | grep -v ".spec."
```

Expected: empty output. If anything appears, that file was missed by an earlier task — go back and update.

- [ ] Open one PR per task (or one combined PR if commits are clean and small) targeting `master`. Use the `/submit-branch` and `/land-pr` skills if available.

---

## Out of scope (intentionally left alone)

- `functions/attachment.ts:10` reads `xdm_e` from the request URL. The frontend caller for attachment uploads is not yet known; investigate separately before touching this. The frontend may still need to send `xdm_e=` to keep that endpoint working.
- `manifest.yml`'s `connect:` block — required for Atlassian's Forge-from-Connect migration upgrade path. Stays.
- `src/utils/ContextParameters/ContextParameters.ts:10` — the canonical entry point for `xdm_e`. Per CLAUDE.md, this is allowed; do not change.
