# Lite Activation Batch 1 (B): Space-admin one-click page template — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer a space admin of a Lite space holding 50–84 diagrams a one-click "Create a diagram page template" in the page banner; the app creates the space template (one ZenUML macro with a starter diagram) through `POST /wiki/rest/api/template` in the admin's own session, so every page creator in that space can start a page from it.

**Architecture:** Task 0 is a go/no-go spike proving a Forge macro extension node survives the template endpoint and renders on a page created from that template. The banner gate extends `decidePageBanner()` with a `template-offer` choice that reads two markers already written on every Lite page load — the space-admin probe marker (`isAdmin`) and the paywall targeting marker (`macroCount`) — so no new probe or network call runs on the hot path. A pure ADF builder and a thin REST client are unit-tested; the banner component owns the funnel events.

**Tech Stack:** Vue 3 `<script setup>`, TypeScript, vitest, `@forge/bridge` `requestConfluence` (via `forgeRequest` in `src/utils/requestUtil.ts:58`), Confluence REST v1 template API, Playwright E2E (lite-stg), Mixpanel via `trackAnalyticsEvent`.

**Spec:** `docs/analysis/2026-08-22-lite-activation-priority/README.md` — "决策记录" decisions 5, 6, 10, 12; "Go / no-go" row T5; evidence file `forge-template-feasibility.md` (with the 2026-08-22 scope correction).

## Global Constraints

- Lite only (`import.meta.env.PRODUCT_TYPE === 'lite'`).
- No manifest scope change. `POST /wiki/rest/api/template` requires classic scope `write:confluence-content`, declared at `manifest.yml` `permissions.scopes` item 7. Adding any scope is a major version — forbidden here.
- Seed band is **50 ≤ macroCount ≤ 84** (decision 6): below the paywall warn threshold (85) so template-driven first creators are not metered.
- Events first (decision 10): `template_offer_shown`, `template_offer_clicked`, `template_created`, `template_create_failed`, `template_offer_dismissed`.
- Banner priority stays `paywall > paywall-admin > template-offer > csat` (`src/routes/pageBanner.ts`). The offer never shows with a paywall banner.
- Offer suppression: once created → never again for that space; dismissed → 30 days.
- The spike (Task 0) is a hard gate: if a Forge macro node does not render from a template, stop and fall back to the manual-instructions variant (decision log path c) — report, do not improvise.
- Commit subjects one line; every commit builds (`pnpm build:lite`) and passes `pnpm test:unit`.

---

## File structure

| File | Responsibility |
|---|---|
| `scripts/spike/template-with-macro.mjs` | Task 0 spike: capture a macro ADF node from a lite-stg page, create a space template with it, print the template id |
| `docs/superpowers/plans/2026-08-22-template-spike-result.md` | Task 0 outcome (go / no-go with screenshot path) |
| `src/utils/analytics/catalog.ts`, `types.ts`, `docs/analytics/events-catalog.md` | Event names + `template_id` property (Task 1) |
| `src/utils/template/variantApp.ts` (+ spec) | Per-variant Forge app id + Lite macro key for the `extensionKey` (Task 2) |
| `src/utils/template/macroTemplateAdf.ts` (+ spec) | Pure ADF builder for "heading + intro + one macro" (Task 2) |
| `src/utils/template/createSpaceTemplate.ts` (+ spec) | REST call + response parsing (Task 3) |
| `src/utils/template/templateOfferMarker.ts` (+ spec) | localStorage marker: created / dismissed / eligible band check (Task 4) |
| `src/routes/pageBanner.ts` (+ spec) | `template-offer` choice, mount (Task 4) |
| `src/components/UpgradePrompt/TemplateOfferBanner.vue` (+ spec) | Copy, buttons, funnel events (Task 5) |
| `tests/e2e-tests/tests/insert/template-offer.spec.ts` | Staging E2E with mocked markers (Task 6) |
| `docs/analysis/2026-08-22-lite-activation-priority/readout-t5.js`, `readout-t5-d1.sql` | 30-day / 90-day readout queries (Task 7) |

---

### Task 0: Spike — does a Forge macro survive the template endpoint? (0.5 day, hard gate)

**Files:**
- Create: `scripts/spike/template-with-macro.mjs`
- Create: `docs/superpowers/plans/2026-08-22-template-spike-result.md`

**Interfaces:**
- Consumes: `FORGE_EMAIL` + `FORGE_API_TOKEN` from `.env.forge.local` (REST basic auth on lite-stg; the identity is a lite-stg Confluence App admin per `/Users/pengxiao/workspaces/CLAUDE.md` identity map). Never print the token.
- Produces: the exact ADF extension node shape that works (copied into Task 2's builder), and a rendered-page screenshot.

- [ ] **Step 1: Pick a source page**

On `lite-stg.atlassian.net`, take any published page that holds one Lite sequence-family macro (mermaid) — e.g. a page produced by the `insert` E2E suite (title prefix "Smoke Test"). Note its page id `SRC_PAGE_ID` and space key `SPACE_KEY` (a staging test space, not a customer space).

- [ ] **Step 2: Write the spike script**

```js
// scripts/spike/template-with-macro.mjs
// Usage: SRC_PAGE_ID=123 SPACE_KEY=TEST node scripts/spike/template-with-macro.mjs
// Reads FORGE_EMAIL / FORGE_API_TOKEN from .env.forge.local. Prints the captured
// extension node and the created templateId. Never prints the token.
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env.forge.local', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.startsWith('#')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const SITE = process.env.SITE || 'https://lite-stg.atlassian.net';
const AUTH = 'Basic ' + Buffer.from(`${env.FORGE_EMAIL}:${env.FORGE_API_TOKEN}`).toString('base64');
const { SRC_PAGE_ID, SPACE_KEY } = process.env;
if (!SRC_PAGE_ID || !SPACE_KEY) { console.error('SRC_PAGE_ID and SPACE_KEY are required'); process.exit(2); }

async function call(path, init = {}) {
  const res = await fetch(SITE + path, { ...init, headers: { Authorization: AUTH, Accept: 'application/json', 'Content-Type': 'application/json', ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || 'GET'} ${path} → ${res.status}: ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

// 1. Capture the page's ADF and pull the first ZenUML extension node.
const page = await call(`/wiki/api/v2/pages/${SRC_PAGE_ID}?body-format=atlas_doc_format`);
const adf = JSON.parse(page.body.atlas_doc_format.value);
function findExtension(node) {
  if (!node || typeof node !== 'object') return undefined;
  if (['extension', 'bodiedExtension', 'inlineExtension'].includes(node.type) && String(node.attrs?.extensionKey || '').includes('zenuml')) return node;
  for (const c of node.content || []) { const hit = findExtension(c); if (hit) return hit; }
  return undefined;
}
const ext = findExtension(adf);
if (!ext) { console.error('no zenuml extension node on the source page'); process.exit(3); }
// Drop instance identity so the template stamps a fresh macro per page.
delete ext.attrs.localId;
if (ext.attrs.parameters) delete ext.attrs.parameters.localId;
console.log('captured extension node:\n' + JSON.stringify(ext, null, 2));

// 2. Create a space template whose body is: heading + paragraph + that node.
const body = { version: 1, type: 'doc', content: [
  { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Design note' }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Describe the change, then keep the diagram below current.' }] },
  ext,
] };
const created = await call('/wiki/rest/api/template', { method: 'POST', body: JSON.stringify({
  name: `ZenUML spike ${new Date().toISOString().slice(0, 16)}`,
  templateType: 'page',
  description: 'Spike: Forge macro inside a space template',
  space: { key: SPACE_KEY },
  body: { atlas_doc_format: { value: JSON.stringify(body), representation: 'atlas_doc_format' } },
}) });
console.log('templateId:', created.templateId, 'editorVersion:', created.editorVersion);
```

- [ ] **Step 3: Run it**

Run: `SRC_PAGE_ID=<id> SPACE_KEY=<key> node scripts/spike/template-with-macro.mjs`
Expected: prints the node and a `templateId`. If the POST returns 400, retry once with `body: { storage: { value: '<ac:adf-extension>…', representation: 'storage' } }` is **not** worth it (the community thread reports storage-format extension nodes failing on pages) — record the 400 body and go to Step 6 (no-go).

- [ ] **Step 4: Create a page from the template in the real UI**

With agent-browser (`--session conf-app --restore=stg`): open `https://lite-stg.atlassian.net/wiki/spaces/<SPACE_KEY>/overview` → Create → Templates → pick the spike template → publish the page → screenshot to `docs/superpowers/plans/assets/2026-08-22-template-spike.png`. Then open the published page and confirm the macro iframe renders a diagram (not "Error loading the extension!" and not an empty macro). Check the page's ADF via `GET /wiki/api/v2/pages/<newId>?body-format=atlas_doc_format` and confirm the extension node carries a fresh `localId`.

- [ ] **Step 5: Open the macro editor from that page**

Click Edit on the rendered macro: the editor must open with the starter diagram and Publish must create a custom content (`macro_create_succeeded` fires — check the network tab for `/forge-custom-content` or Mixpanel after ~1 h). This is the event the north star counts.

- [ ] **Step 6: Record the result**

Write `docs/superpowers/plans/2026-08-22-template-spike-result.md`: GO (node shape verbatim, screenshot path, editor-open result) or NO-GO (exact error, what was tried). On NO-GO stop this plan and report; the fallback is the manual-instructions banner (same Tasks 1, 4, 5 with the button replaced by a step list and no REST call).

- [ ] **Step 7: Commit**

```bash
git add scripts/spike/template-with-macro.mjs docs/superpowers/plans/2026-08-22-template-spike-result.md docs/superpowers/plans/assets/2026-08-22-template-spike.png
git commit -m "spike: prove a Forge macro node survives POST /template and renders from a page created off it"
```

---

### Task 1: Analytics vocabulary (first code commit)

**Files:**
- Modify: `src/utils/analytics/catalog.ts` (`AnalyticsEventName`), `src/utils/analytics/types.ts` (`AnalyticsProperties`), `docs/analytics/events-catalog.md`
- Test: `src/utils/analytics/templateEventVocabulary.spec.ts`

**Interfaces:**
- Produces: `template_offer_shown`, `template_offer_clicked`, `template_created`, `template_create_failed`, `template_offer_dismissed`; properties `template_id?: string`, `macro_count?: number` (already exists — verify with `grep -n "macro_count" src/utils/analytics/types.ts`; add only if absent).

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/analytics/templateEventVocabulary.spec.ts
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CATALOG_TS = readFileSync(resolve(HERE, 'catalog.ts'), 'utf8')
const TYPES_TS = readFileSync(resolve(HERE, 'types.ts'), 'utf8')
const CATALOG_MD = readFileSync(resolve(HERE, '../../../docs/analytics/events-catalog.md'), 'utf8')

const NAMES = ['template_offer_shown', 'template_offer_clicked', 'template_created', 'template_create_failed', 'template_offer_dismissed']

describe('space-template offer event vocabulary', () => {
  for (const n of NAMES) it(`declares and documents ${n}`, () => {
    expect(CATALOG_TS).toContain(`| "${n}"`)
    expect(CATALOG_MD).toContain(n)
  })
  it('declares template_id', () => { expect(TYPES_TS).toMatch(/template_id\?: string/) })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest --run src/utils/analytics/templateEventVocabulary.spec.ts`
Expected: FAIL

- [ ] **Step 3: Add names, property, docs**

In `catalog.ts`, after the `paywall_banner_dismissed` member:

```ts
  // Space-admin page-template offer (Lite activation batch 1, T5). Shown in the
  // page banner to a space admin of a space holding 50–84 diagrams
  // (docs/analysis/2026-08-22-lite-activation-priority/README.md, decision 6).
  // shown → clicked → created | create_failed; dismissed is the explicit
  // "not now". `macro_count` rides every event; `template_id` on created.
  | "template_offer_shown"
  | "template_offer_clicked"
  | "template_created"
  | "template_create_failed"
  | "template_offer_dismissed"
```

In `types.ts` next to `bundle_price_usd`:

```ts
  // template_created: the Confluence content-template id returned by POST /wiki/rest/api/template.
  template_id?: string;
```

Document the five names in `docs/analytics/events-catalog.md` under the paywall/banner section.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest --run src/utils/analytics/templateEventVocabulary.spec.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/analytics/catalog.ts src/utils/analytics/types.ts src/utils/analytics/templateEventVocabulary.spec.ts docs/analytics/events-catalog.md
git commit -m "analytics: name the space-template offer funnel before building the banner"
```

---

### Task 2: ADF builder for the template body

**Files:**
- Create: `src/utils/template/variantApp.ts`, `src/utils/template/variantApp.spec.ts`
- Create: `src/utils/template/macroTemplateAdf.ts`, `src/utils/template/macroTemplateAdf.spec.ts`

**Interfaces:**
- Consumes: the extension node shape recorded by Task 0 (`extensionType: 'com.atlassian.ecosystem'`, `extensionKey: '<appId>/<envId>/static/<macroKey>'`, `parameters.extensionId: 'ari:cloud:ecosystem::extension/<appId>/<envId>/static/<macroKey>'`). Environment id comes from `forgeGlobal.forgeContext?.environmentId` (typed in `node_modules/@forge/bridge/out/types.d.ts:32`).
- Produces:
  - `liteAppIdentity(): { appId: string; macroKey: string }` — Lite app id `8ad26115-211f-4216-971b-0540f606303d` (`.env.forge.lite:2`), macro key `zenuml-sequence-macro-lite` (`.env.forge.lite:4`). Throws when `import.meta.env.PRODUCT_TYPE !== 'lite'`.
  - `buildMacroTemplateAdf(opts: { appId: string; environmentId: string; macroKey: string; heading: string; intro: string }): AdfDoc` returning the same `{version:1,type:'doc',content:[heading, paragraph, extension]}` shape Task 0 used.

- [ ] **Step 1: Write the failing tests**

```ts
// src/utils/template/variantApp.spec.ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { liteAppIdentity } from './variantApp'

afterEach(() => vi.unstubAllEnvs())

describe('liteAppIdentity', () => {
  it('returns the Lite Forge app id and sequence-family macro key', () => {
    vi.stubEnv('PRODUCT_TYPE', 'lite')
    expect(liteAppIdentity()).toEqual({ appId: '8ad26115-211f-4216-971b-0540f606303d', macroKey: 'zenuml-sequence-macro-lite' })
  })
  it('refuses to run in any other variant', () => {
    vi.stubEnv('PRODUCT_TYPE', 'full')
    expect(() => liteAppIdentity()).toThrow(/lite/i)
  })
})
```

```ts
// src/utils/template/macroTemplateAdf.spec.ts
import { describe, it, expect } from 'vitest'
import { buildMacroTemplateAdf } from './macroTemplateAdf'

const OPTS = { appId: '8ad26115-211f-4216-971b-0540f606303d', environmentId: 'env-1', macroKey: 'zenuml-sequence-macro-lite', heading: 'Design note', intro: 'Keep the diagram current.' }

describe('buildMacroTemplateAdf', () => {
  it('produces heading, intro paragraph and one ecosystem extension node', () => {
    const doc = buildMacroTemplateAdf(OPTS)
    expect(doc.version).toBe(1)
    expect(doc.content.map(n => n.type)).toEqual(['heading', 'paragraph', 'extension'])
    const ext = doc.content[2] as any
    expect(ext.attrs.extensionType).toBe('com.atlassian.ecosystem')
    expect(ext.attrs.extensionKey).toBe('8ad26115-211f-4216-971b-0540f606303d/env-1/static/zenuml-sequence-macro-lite')
    expect(ext.attrs.parameters.extensionId).toBe('ari:cloud:ecosystem::extension/8ad26115-211f-4216-971b-0540f606303d/env-1/static/zenuml-sequence-macro-lite')
    expect(ext.attrs.localId).toBeUndefined()
  })
  it('serialises to JSON without undefined holes', () => {
    expect(JSON.parse(JSON.stringify(buildMacroTemplateAdf(OPTS)))).toEqual(buildMacroTemplateAdf(OPTS))
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest --run src/utils/template`
Expected: FAIL — modules not found

- [ ] **Step 3: Implement**

```ts
// src/utils/template/variantApp.ts
/**
 * Build-time identity of the Lite app, needed to write a macro extension node
 * into a template body. Forge's view context exposes environmentId but not the
 * app id, so the id is pinned here (source: .env.forge.lite, also echoed in
 * wrangler-prod.toml's ALLOWED_FORGE_APP_IDS comment).
 */
export function liteAppIdentity(): { appId: string; macroKey: string } {
  if (import.meta.env.PRODUCT_TYPE !== 'lite') {
    throw new Error('space-template offer is a Lite-only feature')
  }
  return { appId: '8ad26115-211f-4216-971b-0540f606303d', macroKey: 'zenuml-sequence-macro-lite' }
}
```

```ts
// src/utils/template/macroTemplateAdf.ts
export type AdfNode = { type: string; attrs?: Record<string, unknown>; content?: AdfNode[]; text?: string }
export type AdfDoc = { version: 1; type: 'doc'; content: AdfNode[] }

/**
 * Template body: heading + intro + one ZenUML macro. The extension node shape
 * is the one proven by scripts/spike/template-with-macro.mjs (2026-08-22):
 * no localId — Confluence stamps a fresh one on every page created from the
 * template, which is what makes each page's macro its own custom content.
 */
export function buildMacroTemplateAdf(opts: { appId: string; environmentId: string; macroKey: string; heading: string; intro: string }): AdfDoc {
  const path = `${opts.appId}/${opts.environmentId}/static/${opts.macroKey}`
  return {
    version: 1,
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: opts.heading }] },
      { type: 'paragraph', content: [{ type: 'text', text: opts.intro }] },
      {
        type: 'extension',
        attrs: {
          layout: 'default',
          extensionType: 'com.atlassian.ecosystem',
          extensionKey: path,
          text: 'Diagram',
          parameters: {
            extensionId: `ari:cloud:ecosystem::extension/${path}`,
            extensionTitle: 'Diagram',
            guestParams: {},
          },
        },
      },
    ],
  }
}
```

If Task 0's captured node carried additional `attrs.parameters` fields that the viewer needs (e.g. a `guestParams` key the macro reads), copy them verbatim here and extend the first test accordingly.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm vitest --run src/utils/template`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/template/variantApp.ts src/utils/template/variantApp.spec.ts src/utils/template/macroTemplateAdf.ts src/utils/template/macroTemplateAdf.spec.ts
git commit -m "template: pure ADF builder for a one-macro page template, shaped by the spike's proven node"
```

---

### Task 3: REST client — create the space template as the admin

**Files:**
- Create: `src/utils/template/createSpaceTemplate.ts`, `src/utils/template/createSpaceTemplate.spec.ts`

**Interfaces:**
- Consumes: `forgeRequest(url, method, data)` from `src/utils/requestUtil.ts:58-71` (wraps `@forge/bridge` `requestConfluence`, runs as the current user); `buildMacroTemplateAdf` (Task 2).
- Produces: `createSpaceTemplate(opts: { spaceKey: string; name: string; adf: AdfDoc }): Promise<{ templateId: string }>`; throws `TemplateCreateError` with `reason: 'forbidden' | 'bad_request' | 'network' | 'unexpected'`.

- [ ] **Step 1: Write the failing test**

```ts
// src/utils/template/createSpaceTemplate.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
const forgeRequest = vi.fn()
vi.mock('@/utils/requestUtil', () => ({ forgeRequest: (...a: any[]) => forgeRequest(...a) }))
import { createSpaceTemplate, TemplateCreateError } from './createSpaceTemplate'

const ADF = { version: 1 as const, type: 'doc' as const, content: [] }

beforeEach(() => forgeRequest.mockReset())

describe('createSpaceTemplate', () => {
  it('POSTs a page template with an atlas_doc_format body scoped to the space', async () => {
    forgeRequest.mockResolvedValue({ templateId: '99', name: 'Diagram page' })
    const r = await createSpaceTemplate({ spaceKey: 'ENG', name: 'Diagram page', adf: ADF })
    expect(forgeRequest).toHaveBeenCalledWith('/wiki/rest/api/template', 'POST', {
      name: 'Diagram page',
      templateType: 'page',
      description: 'Start a page with a ZenUML diagram. Created by ZenUML Lite.',
      space: { key: 'ENG' },
      body: { atlas_doc_format: { value: JSON.stringify(ADF), representation: 'atlas_doc_format' } },
    })
    expect(r).toEqual({ templateId: '99' })
  })
  it('maps a 403 body to reason forbidden', async () => {
    forgeRequest.mockResolvedValue({ statusCode: 403, message: 'no permission' })
    await expect(createSpaceTemplate({ spaceKey: 'ENG', name: 'x', adf: ADF })).rejects.toMatchObject({ reason: 'forbidden' })
  })
  it('maps a thrown fetch error to reason network', async () => {
    forgeRequest.mockRejectedValue(new Error('Failed to fetch'))
    await expect(createSpaceTemplate({ spaceKey: 'ENG', name: 'x', adf: ADF })).rejects.toBeInstanceOf(TemplateCreateError)
  })
  it('treats a response without templateId as unexpected', async () => {
    forgeRequest.mockResolvedValue({})
    await expect(createSpaceTemplate({ spaceKey: 'ENG', name: 'x', adf: ADF })).rejects.toMatchObject({ reason: 'unexpected' })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest --run src/utils/template/createSpaceTemplate.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

`forgeRequest` returns `response.json()` regardless of status (`requestUtil.ts:58-71`), so errors arrive as Confluence error bodies (`statusCode`, `message`) rather than thrown — handle both.

```ts
// src/utils/template/createSpaceTemplate.ts
import { forgeRequest } from '@/utils/requestUtil'
import type { AdfDoc } from './macroTemplateAdf'

export type TemplateCreateReason = 'forbidden' | 'bad_request' | 'network' | 'unexpected'

export class TemplateCreateError extends Error {
  constructor(public reason: TemplateCreateReason, message: string) { super(message); this.name = 'TemplateCreateError' }
}

export const TEMPLATE_DESCRIPTION = 'Start a page with a ZenUML diagram. Created by ZenUML Lite.'

/**
 * Creates a SPACE content template in the current user's session. Requires the
 * caller to be a space admin (Confluence enforces it; the banner gate only shows
 * the offer to one). Classic scope write:confluence-content covers the call —
 * no manifest change (docs/analysis/2026-08-22-lite-activation-priority/forge-template-feasibility.md).
 */
export async function createSpaceTemplate(opts: { spaceKey: string; name: string; adf: AdfDoc }): Promise<{ templateId: string }> {
  let res: any
  try {
    res = await forgeRequest('/wiki/rest/api/template', 'POST', {
      name: opts.name,
      templateType: 'page',
      description: TEMPLATE_DESCRIPTION,
      space: { key: opts.spaceKey },
      body: { atlas_doc_format: { value: JSON.stringify(opts.adf), representation: 'atlas_doc_format' } },
    })
  } catch (e: any) {
    throw new TemplateCreateError('network', e?.message || 'request failed')
  }
  if (res && typeof res.statusCode === 'number') {
    const reason: TemplateCreateReason = res.statusCode === 403 ? 'forbidden' : res.statusCode === 400 ? 'bad_request' : 'unexpected'
    throw new TemplateCreateError(reason, String(res.message || res.statusCode))
  }
  if (!res || !res.templateId) throw new TemplateCreateError('unexpected', 'no templateId in response')
  return { templateId: String(res.templateId) }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm vitest --run src/utils/template/createSpaceTemplate.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/utils/template/createSpaceTemplate.ts src/utils/template/createSpaceTemplate.spec.ts
git commit -m "template: create a space page template in the admin's session through the v1 template API"
```

---

### Task 4: Banner gate — `template-offer`

**Files:**
- Create: `src/utils/template/templateOfferMarker.ts`, `src/utils/template/templateOfferMarker.spec.ts`
- Modify: `src/routes/pageBanner.ts:24-46` (`PageBannerChoice`, `decidePageBanner`) and `:57-89` (`handlePageBannerRoute`)
- Modify: `src/routes/pageBanner.spec.ts`

**Interfaces:**
- Consumes: `isCurrentUserSpaceAdmin(identity)` (`spaceAdminProbe.ts:117`), `readTargetingMarker(identity)` (`warningBanner.ts:161`, returns `{ macroCount, spacePaid, ... } | null`), `deriveWarningBannerIdentity()` (`{ clientDomain, spaceKey }`), `isCsatPendingFresh(now)`.
- Produces:
  - `TEMPLATE_OFFER_MIN = 50`, `TEMPLATE_OFFER_MAX = 84`
  - `isInTemplateOfferBand(macroCount: number | undefined): boolean`
  - `readTemplateOfferMarker(identity): { createdAt?: string; dismissedAt?: string; templateId?: string } | null`, `markTemplateCreated(identity, templateId, now)`, `markTemplateOfferDismissed(identity, now)`, `isTemplateOfferSuppressed(identity, now): boolean` (created ever, or dismissed < 30 days).
  - `PageBannerChoice` gains `'template-offer'`; `decidePageBanner` returns it when Lite, admin, in band, not suppressed, and no paywall choice won.

- [ ] **Step 0: Verify the gate's inputs exist on viewer loads (reach depends on it)**

The gate reads `readTargetingMarker(identity)?.macroCount`. That marker is written by `persistTargetingMarker()` inside `useCustomerSuccessService.initialize()` (`src/composables/useCustomerSuccessService.ts:276-298`), and `initialize()` is called from `src/forgeIndex.ts:293`. Confirm by reading those lines that (a) `initialize()` runs on the page-banner / viewer path for every Lite load, not only at editor mount, and (b) the marker is written with `severity: 'none'` for counts below 85 (the 50–84 band) rather than skipped. If either is false, the offer reaches only admins who recently opened an editor in that space: add a `persistTargetingMarker()` call on the banner path in this task and note the change in the deviation log; do not proceed with a gate whose input is absent for the target audience. The E2E in Task 6 mocks the marker and therefore cannot catch this.

- [ ] **Step 1: Write the failing marker tests**

```ts
// src/utils/template/templateOfferMarker.spec.ts
import { describe, it, expect, beforeEach } from 'vitest'
import { isInTemplateOfferBand, isTemplateOfferSuppressed, markTemplateCreated, markTemplateOfferDismissed, readTemplateOfferMarker } from './templateOfferMarker'

const ID = { clientDomain: 'example-tenant', spaceKey: 'ENG' }
const NOW = Date.parse('2026-09-01T00:00:00Z')
const DAY = 86_400_000

beforeEach(() => localStorage.clear())

describe('band', () => {
  it('accepts 50..84 only', () => {
    expect(isInTemplateOfferBand(49)).toBe(false)
    expect(isInTemplateOfferBand(50)).toBe(true)
    expect(isInTemplateOfferBand(84)).toBe(true)
    expect(isInTemplateOfferBand(85)).toBe(false)
    expect(isInTemplateOfferBand(undefined)).toBe(false)
  })
})

describe('suppression', () => {
  it('is not suppressed with no marker', () => { expect(isTemplateOfferSuppressed(ID, NOW)).toBe(false) })
  it('is suppressed forever once a template was created', () => {
    markTemplateCreated(ID, '99', NOW)
    expect(readTemplateOfferMarker(ID)).toMatchObject({ templateId: '99' })
    expect(isTemplateOfferSuppressed(ID, NOW + 400 * DAY)).toBe(true)
  })
  it('is suppressed for 30 days after dismiss, then eligible again', () => {
    markTemplateOfferDismissed(ID, NOW)
    expect(isTemplateOfferSuppressed(ID, NOW + 29 * DAY)).toBe(true)
    expect(isTemplateOfferSuppressed(ID, NOW + 31 * DAY)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm vitest --run src/utils/template/templateOfferMarker.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement the marker module**

```ts
// src/utils/template/templateOfferMarker.ts
import type { WarningBannerIdentity } from '@/utils/paywall/warningBanner'

export const TEMPLATE_OFFER_MIN = 50
export const TEMPLATE_OFFER_MAX = 84
const DISMISS_WINDOW_MS = 30 * 86_400_000

export interface TemplateOfferMarker { createdAt?: string; templateId?: string; dismissedAt?: string }

function key(id: WarningBannerIdentity) {
  return `zenumlTemplateOffer:${encodeURIComponent(id.clientDomain)}:${encodeURIComponent(id.spaceKey)}`
}

export function isInTemplateOfferBand(macroCount: number | undefined): boolean {
  return typeof macroCount === 'number' && Number.isFinite(macroCount) && macroCount >= TEMPLATE_OFFER_MIN && macroCount <= TEMPLATE_OFFER_MAX
}

export function readTemplateOfferMarker(id: WarningBannerIdentity): TemplateOfferMarker | null {
  try {
    const raw = localStorage.getItem(key(id))
    if (!raw) return null
    const p = JSON.parse(raw)
    return p && typeof p === 'object' ? p : null
  } catch { return null }
}

function write(id: WarningBannerIdentity, m: TemplateOfferMarker) {
  try { localStorage.setItem(key(id), JSON.stringify(m)) } catch { /* best effort */ }
}

export function markTemplateCreated(id: WarningBannerIdentity, templateId: string, now = Date.now()) {
  write(id, { ...(readTemplateOfferMarker(id) || {}), createdAt: new Date(now).toISOString(), templateId })
}

export function markTemplateOfferDismissed(id: WarningBannerIdentity, now = Date.now()) {
  write(id, { ...(readTemplateOfferMarker(id) || {}), dismissedAt: new Date(now).toISOString() })
}

export function isTemplateOfferSuppressed(id: WarningBannerIdentity, now = Date.now()): boolean {
  const m = readTemplateOfferMarker(id)
  if (!m) return false
  if (m.createdAt) return true
  if (m.dismissedAt) {
    const t = Date.parse(m.dismissedAt)
    if (Number.isFinite(t) && now - t < DISMISS_WINDOW_MS) return true
  }
  return false
}
```

- [ ] **Step 4: Run marker tests**

Run: `pnpm vitest --run src/utils/template/templateOfferMarker.spec.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the failing pageBanner tests**

Extend `src/routes/pageBanner.spec.ts`. Add mocks beside the existing ones:

```ts
vi.mock('@/utils/template/templateOfferMarker', () => ({
  isInTemplateOfferBand: vi.fn(), isTemplateOfferSuppressed: vi.fn(),
}))
vi.mock('@/components/UpgradePrompt/TemplateOfferBanner.vue', () => ({ default: { name: 'TemplateOfferBanner' } }))
const readTargeting = vi.fn()
vi.mock('@/utils/paywall/warningBanner', () => ({
  shouldShowPaywallBanner: vi.fn(), deriveWarningBannerIdentity: vi.fn(), readTargetingMarker: (...a: any[]) => readTargeting(...a),
}))
```

(Replace the file's existing `warningBanner` mock with this one — same two functions plus `readTargetingMarker`.) Then the cases, inside the existing `describe('decidePageBanner …')`:

```ts
  describe('template-offer (Lite activation T5)', () => {
    const band = vi.mocked((await import('@/utils/template/templateOfferMarker')).isInTemplateOfferBand)
    const suppressed = vi.mocked((await import('@/utils/template/templateOfferMarker')).isTemplateOfferSuppressed)
    beforeEach(() => {
      vi.stubEnv('PRODUCT_TYPE', 'lite')
      identity.mockReturnValue(IDENTITY); paywall.mockReturnValue(false); csat.mockReturnValue(false)
      isAdmin.mockReturnValue(true); readTargeting.mockReturnValue({ macroCount: 60 }); band.mockReturnValue(true); suppressed.mockReturnValue(false)
    })
    afterEach(() => vi.unstubAllEnvs())

    it('offers the template to an admin of an in-band space', () => { expect(decidePageBanner(0)).toBe('template-offer') })
    it('never outranks the paywall banner', () => { paywall.mockReturnValue(true); expect(decidePageBanner(0)).toBe('paywall') })
    it('needs the admin verdict', () => { isAdmin.mockReturnValue(false); expect(decidePageBanner(0)).toBe('none') })
    it('needs the band', () => { band.mockReturnValue(false); expect(decidePageBanner(0)).toBe('none') })
    it('respects suppression', () => { suppressed.mockReturnValue(true); expect(decidePageBanner(0)).toBe('none') })
    it('outranks CSAT', () => { csat.mockReturnValue(true); expect(decidePageBanner(0)).toBe('template-offer') })
    it('is Lite-only', () => { vi.stubEnv('PRODUCT_TYPE', 'full'); expect(decidePageBanner(0)).toBe('none') })
    it('mounts TemplateOfferBanner with the macro count', async () => {
      await handlePageBannerRoute('template-offer')
      expect(createdWith).toEqual({ macroCount: 60 })
    })
  })
```

(`identity`, `paywall`, `csat`, `isAdmin`, `createdWith` are the spec's existing handles. Check `handlePageBannerRoute`'s signature at `pageBanner.ts:57` — if it derives the choice itself rather than taking one, call it the way the existing `paywall-admin` test does.)

- [ ] **Step 6: Run to verify they fail**

Run: `pnpm vitest --run src/routes/pageBanner.spec.ts -t "template-offer"`
Expected: FAIL — `expected 'none' to be 'template-offer'`

- [ ] **Step 7: Extend `pageBanner.ts`**

```ts
export type PageBannerChoice = 'paywall' | 'paywall-admin' | 'template-offer' | 'csat' | 'none';
```

Imports:

```ts
import { readTargetingMarker } from '@/utils/paywall/warningBanner';
import { isInTemplateOfferBand, isTemplateOfferSuppressed } from '@/utils/template/templateOfferMarker';
```

`decidePageBanner` — insert between the `paywall-admin` return and the CSAT check:

```ts
  // Lite activation T5: one-click space template for an admin of a 50–84
  // diagram space. Both inputs are markers already on disk — the admin probe's
  // verdict and the paywall targeting marker's macroCount — so this stays
  // synchronous like every other choice here.
  if (
    import.meta.env.PRODUCT_TYPE === 'lite' &&
    isCurrentUserSpaceAdmin(identity) &&
    isInTemplateOfferBand(readTargetingMarker(identity)?.macroCount) &&
    !isTemplateOfferSuppressed(identity, now)
  ) {
    return 'template-offer';
  }
```

`handlePageBannerRoute` — add a branch mirroring the `csat` one (dynamic import + `createApp(Component, props).mount('#app')`):

```ts
    case 'template-offer': {
      const { default: TemplateOfferBanner } = await import('@/components/UpgradePrompt/TemplateOfferBanner.vue');
      const macroCount = readTargetingMarker(deriveWarningBannerIdentity())?.macroCount ?? 0;
      createApp(TemplateOfferBanner, { macroCount }).mount('#app');
      return 'template-offer';
    }
```

(Adapt to the file's actual control flow — it may use `if` chains rather than `switch`; keep the existing mount idiom.)

- [ ] **Step 8: Run pageBanner + marker tests**

Run: `pnpm vitest --run src/routes/pageBanner.spec.ts src/utils/template`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/utils/template/templateOfferMarker.ts src/utils/template/templateOfferMarker.spec.ts src/routes/pageBanner.ts src/routes/pageBanner.spec.ts
git commit -m "page-banner: offer a space template to admins of 50–84-diagram Lite spaces, below the paywall banner in priority"
```

---

### Task 5: `TemplateOfferBanner.vue`

**Files:**
- Create: `src/components/UpgradePrompt/TemplateOfferBanner.vue`, `src/components/UpgradePrompt/TemplateOfferBanner.spec.ts`

**Interfaces:**
- Consumes: `createSpaceTemplate` (Task 3), `buildMacroTemplateAdf` + `liteAppIdentity` (Task 2), `markTemplateCreated` / `markTemplateOfferDismissed` (Task 4), `deriveWarningBannerIdentity()`, `forgeGlobal.forgeContext?.environmentId`, `trackAnalyticsEvent`, `@forge/bridge` `view.close()` (look at `CsatBanner.vue` for how the banner closes itself and copy that call).
- Props: `macroCount: number`.
- Events (all `feature_area: 'upgrade'`, `surface: 'page_banner'`, `macro_count`): `template_offer_shown` on mount; `template_offer_clicked`; `template_created{template_id}` / `template_create_failed{failure_reason}`; `template_offer_dismissed`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/components/UpgradePrompt/TemplateOfferBanner.spec.ts
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const createSpaceTemplate = vi.fn()
const track = vi.fn()
const close = vi.fn()
vi.mock('@/utils/template/createSpaceTemplate', () => ({ createSpaceTemplate: (...a: any[]) => createSpaceTemplate(...a), TemplateCreateError: class extends Error { constructor(public reason: string, m: string) { super(m) } } }))
vi.mock('@/utils/template/variantApp', () => ({ liteAppIdentity: () => ({ appId: 'app', macroKey: 'zenuml-sequence-macro-lite' }) }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: (...a: any[]) => track(...a) }))
vi.mock('@/utils/paywall/warningBanner', () => ({ deriveWarningBannerIdentity: () => ({ clientDomain: 'example-tenant', spaceKey: 'ENG' }) }))
vi.mock('@/model/globals/forgeGlobal', () => ({ default: { forgeContext: { environmentId: 'env-1' } } }))
vi.mock('@forge/bridge', () => ({ view: { close: () => close() } }))

import TemplateOfferBanner from './TemplateOfferBanner.vue'
import { readTemplateOfferMarker } from '@/utils/template/templateOfferMarker'

beforeEach(() => { vi.clearAllMocks(); localStorage.clear() })

describe('TemplateOfferBanner', () => {
  it('reports shown on mount with the macro count', () => {
    mount(TemplateOfferBanner, { props: { macroCount: 60 } })
    expect(track).toHaveBeenCalledWith('template_offer_shown', expect.objectContaining({ surface: 'page_banner', macro_count: 60 }))
  })
  it('creates the template, records it, and shows the success state', async () => {
    createSpaceTemplate.mockResolvedValue({ templateId: '99' })
    const w = mount(TemplateOfferBanner, { props: { macroCount: 60 } })
    await w.get('[data-testid="template-offer-create"]').trigger('click')
    await flushPromises()
    expect(createSpaceTemplate).toHaveBeenCalledWith(expect.objectContaining({ spaceKey: 'ENG', name: 'Diagram page' }))
    expect(track).toHaveBeenCalledWith('template_offer_clicked', expect.anything())
    expect(track).toHaveBeenCalledWith('template_created', expect.objectContaining({ template_id: '99' }))
    expect(readTemplateOfferMarker({ clientDomain: 'example-tenant', spaceKey: 'ENG' })).toMatchObject({ templateId: '99' })
    expect(w.text()).toContain('Template created')
  })
  it('reports a failure with its reason and keeps the offer open', async () => {
    const { TemplateCreateError } = await import('@/utils/template/createSpaceTemplate')
    createSpaceTemplate.mockRejectedValue(new (TemplateCreateError as any)('forbidden', 'nope'))
    const w = mount(TemplateOfferBanner, { props: { macroCount: 60 } })
    await w.get('[data-testid="template-offer-create"]').trigger('click')
    await flushPromises()
    expect(track).toHaveBeenCalledWith('template_create_failed', expect.objectContaining({ failure_reason: 'forbidden' }))
    expect(w.text()).toContain('could not create')
  })
  it('dismiss records a 30-day snooze and closes the banner', async () => {
    const w = mount(TemplateOfferBanner, { props: { macroCount: 60 } })
    await w.get('[data-testid="template-offer-dismiss"]').trigger('click')
    expect(track).toHaveBeenCalledWith('template_offer_dismissed', expect.anything())
    expect(readTemplateOfferMarker({ clientDomain: 'example-tenant', spaceKey: 'ENG' })?.dismissedAt).toBeTruthy()
    expect(close).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest --run src/components/UpgradePrompt/TemplateOfferBanner.spec.ts`
Expected: FAIL — cannot resolve `./TemplateOfferBanner.vue`

- [ ] **Step 3: Implement the component**

```vue
<!-- src/components/UpgradePrompt/TemplateOfferBanner.vue -->
<template>
  <div class="template-offer" role="region" aria-label="ZenUML page template" data-testid="template-offer-banner">
    <template v-if="state === 'created'">
      <strong>Template created.</strong>
      <span>Anyone creating a page in this space can now pick <em>Diagram page</em> under Templates.</span>
      <button class="template-offer__ghost" data-testid="template-offer-close" @click="closeBanner">Close</button>
    </template>
    <template v-else>
      <strong>This space has {{ macroCount }} diagrams.</strong>
      <span>Add a <em>Diagram page</em> template so your team starts new pages with a diagram in place.</span>
      <button class="template-offer__primary" data-testid="template-offer-create" :disabled="state === 'creating'" @click="create">
        {{ state === 'creating' ? 'Creating…' : 'Create template' }}
      </button>
      <button class="template-offer__ghost" data-testid="template-offer-dismiss" @click="dismiss">Not now</button>
      <span v-if="state === 'failed'" class="template-offer__error" role="alert">ZenUML could not create the template ({{ failureReason }}). You can still add one under Space settings → Templates.</span>
    </template>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import forgeGlobal from '@/model/globals/forgeGlobal'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import { deriveWarningBannerIdentity } from '@/utils/paywall/warningBanner'
import { buildMacroTemplateAdf } from '@/utils/template/macroTemplateAdf'
import { liteAppIdentity } from '@/utils/template/variantApp'
import { createSpaceTemplate, TemplateCreateError } from '@/utils/template/createSpaceTemplate'
import { markTemplateCreated, markTemplateOfferDismissed } from '@/utils/template/templateOfferMarker'

const props = defineProps<{ macroCount: number }>()
const state = ref<'idle' | 'creating' | 'created' | 'failed'>('idle')
const failureReason = ref('')
const identity = deriveWarningBannerIdentity()
const base = () => ({ feature_area: 'upgrade' as const, surface: 'page_banner' as const, macro_count: props.macroCount })

onMounted(() => trackAnalyticsEvent('template_offer_shown', base()))

async function closeBanner() {
  const { view } = await import('@forge/bridge')
  view.close()
}

async function create() {
  trackAnalyticsEvent('template_offer_clicked', base())
  state.value = 'creating'
  try {
    const { appId, macroKey } = liteAppIdentity()
    const environmentId = forgeGlobal.forgeContext?.environmentId
    if (!environmentId) throw new TemplateCreateError('unexpected', 'no environmentId in Forge context')
    const adf = buildMacroTemplateAdf({ appId, environmentId, macroKey, heading: 'Design note', intro: 'Describe the change, then keep the diagram below current.' })
    const { templateId } = await createSpaceTemplate({ spaceKey: identity.spaceKey, name: 'Diagram page', adf })
    markTemplateCreated(identity, templateId)
    trackAnalyticsEvent('template_created', { ...base(), template_id: templateId })
    state.value = 'created'
  } catch (e: any) {
    const reason = e instanceof TemplateCreateError ? e.reason : 'unexpected'
    failureReason.value = reason
    trackAnalyticsEvent('template_create_failed', { ...base(), failure_reason: reason })
    state.value = 'failed'
  }
}

async function dismiss() {
  markTemplateOfferDismissed(identity)
  trackAnalyticsEvent('template_offer_dismissed', base())
  await closeBanner()
}
</script>

<style scoped>
.template-offer { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; padding: 8px 16px; font-size: 13px; background: var(--ds-background-information, #e9f2ff); border-bottom: 1px solid var(--ds-border, #dfe1e6); }
.template-offer__primary { padding: 4px 10px; border-radius: 3px; border: 0; background: var(--ds-background-brand-bold, #0c66e4); color: #fff; cursor: pointer; }
.template-offer__ghost { padding: 4px 10px; border-radius: 3px; border: 0; background: transparent; color: var(--ds-text-subtle, #44546f); cursor: pointer; }
.template-offer__error { flex-basis: 100%; color: var(--ds-text-danger, #ae2a19); }
</style>
```

`failure_reason` already exists in `types.ts` (used by `byline_editor_deeplinked`); `feature_area: 'upgrade'` and `surface: 'page_banner'` are the values `space_admin_active` uses (`spaceAdminProbe.ts:176-183`). If `view.close()` is not how `CsatBanner.vue` closes, copy its mechanism instead.

- [ ] **Step 4: Run the component tests and the unit suite**

Run: `pnpm vitest --run src/components/UpgradePrompt/TemplateOfferBanner.spec.ts && pnpm test:unit`
Expected: PASS

- [ ] **Step 5: Render and look at it**

Mount the banner in the page-banner route locally (`pnpm start:local`, route `pageBanner` with localStorage markers set: targeting `macroCount: 60`, probe `isAdmin: true`) and screenshot the three states (idle, created, failed). It must fit one banner row at 1280 px wide; the error line wraps underneath.

- [ ] **Step 6: Commit**

```bash
git add src/components/UpgradePrompt/TemplateOfferBanner.vue src/components/UpgradePrompt/TemplateOfferBanner.spec.ts
git commit -m "page-banner: one-click Diagram page template for space admins, with the full shown→created funnel"
```

---

### Task 6: E2E on lite-stg with mocked markers

**Files:**
- Create: `tests/e2e-tests/tests/insert/template-offer.spec.ts`
- Modify: `tests/e2e-tests/helpers/pageBanner.ts:82` (`export` the existing `appFrame`)

**Interfaces:**
- Consumes: `createPageAndSetup`, `publishAndVerifyMacros` (`insert-helpers.js`); `setAppMocks(page, entries)` from `tests/e2e-tests/helpers/pageBanner.ts:96` and `appFrame(page)` from the same file (line 82 — it is module-private today; add `export` in this task); the localStorage key formats from the exported key builders `targetingMarkerKey(identity)` (`src/utils/paywall/warningBanner.ts:95`) and `spaceAdminProbeKey(identity)` (`src/utils/paywall/spaceAdminProbe.ts:54`) — copy the string they build into the spec.
- lite-stg's robot account must be a space admin of the test space for the real REST call to succeed; if it is not, the spec asserts the `forbidden` failure path instead and says so in its title.

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e-tests/tests/insert/template-offer.spec.ts
import { test, expect } from '@playwright/test';
import { testConfig } from '../../config/test-config.js';
import { createPageAndSetup, publishAndVerifyMacros } from './insert-helpers.js';
import { setAppMocks, appFrame } from '../../helpers/pageBanner.js';

test.describe(`Space template offer - ${testConfig.productType}`, () => {
  test.skip(!testConfig.isLite, 'Template offer ships on Lite only');

  test('an admin of a 50–84 diagram space sees the offer and can create the template', async ({ page }) => {
    const editorPage = await createPageAndSetup(page, ' Lite');
    expect(editorPage).toBeTruthy();
    await publishAndVerifyMacros(page, ['mermaid']);

    // Force the two gate inputs. Key formats: copy from
    // src/utils/paywall/warningBanner.ts (targeting) and
    // src/utils/paywall/spaceAdminProbe.ts (probe) — keep them in lockstep.
    const domain = new URL(page.url()).host.split('.')[0];
    const spaceKey = await (await appFrame(page))!.evaluate(() => (window as any).forgeGlobal?.forgeContext?.extension?.space?.key);
    await setAppMocks(page, {
      [`zenumlPaywallTargeting:${domain}:${spaceKey}`]: JSON.stringify({ severity: 'none', macroCount: 60, spacePaid: false, customerSuccessServiceEnabled: true, updatedAt: new Date().toISOString() }),
      [`zenumlSpaceAdminProbe:${domain}:${spaceKey}`]: JSON.stringify({ lastProbedAt: new Date().toISOString(), isAdmin: true, adminCount: 1 }),
    });
    await page.reload();

    const banner = page.frameLocator('iframe[src*="pageBanner"], iframe[name*="page-banner"]').locator('[data-testid="template-offer-banner"]');
    await expect(banner).toBeVisible({ timeout: 60000 });
    await banner.locator('[data-testid="template-offer-create"]').click();
    await expect(banner).toContainText(/Template created|could not create/, { timeout: 30000 });
    const text = await banner.innerText();
    test.info().annotations.push({ type: 'result', description: text.includes('Template created') ? 'created' : 'failed:' + text });
    expect(text).toContain('Template created');
  });
});
```

Replace the two localStorage key prefixes with the exact strings built by `targetingMarkerKey()` (`warningBanner.ts:95`) and `spaceAdminProbeKey()` (`spaceAdminProbe.ts:54`) before running. The page-banner iframe selector: confirm against `tests/e2e-tests/helpers/pageBanner.ts`'s own `appFrame` locator and reuse it if it already targets the banner frame.

- [ ] **Step 2: Collect and run**

Run: `cd tests/e2e-tests && npx playwright test --list tests/insert/template-offer.spec.ts`, then after staging deploy: `APP=zenuml-lite@stg npx playwright test --project=auth --project=insert --grep "template offer" --workers=1 --reporter=list`
Expected: 1 passed. Afterwards delete the created template(s) from the staging space (Space settings → Templates) or leave them — they are test data on a staging space.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e-tests/tests/insert/template-offer.spec.ts tests/e2e-tests/helpers/pageBanner.ts
git commit -m "test(e2e): template offer renders for an in-band admin and creates the space template on lite-stg"
```

---

### Task 7: Ship, verify, readout queries

**Files:**
- Create: `docs/analysis/2026-08-22-lite-activation-priority/readout-t5.js`, `docs/analysis/2026-08-22-lite-activation-priority/readout-t5-d1.sql`
- Modify: `docs/analysis/2026-08-22-lite-activation-priority/deviation-log.md`

- [ ] **Step 1: PR + CI** — `submit-branch` (title: "Lite activation batch 1B: space-admin one-click Diagram page template"), `babysit-pr` until green.

- [ ] **Step 2: Readout queries**

```js
// docs/analysis/2026-08-22-lite-activation-priority/readout-t5.js — 30-day funnel
var INTERNAL = ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]; // plus the entries in private/operations/internal-analytics-domain-exclusions.md
function isInternal(d) { if (!d) return true; for (var i = 0; i < INTERNAL.length; i++) if (d.indexOf(INTERNAL[i]) !== -1) return true; return false; }
function main() {
  return Events({from_date: '2026-09-01', to_date: '2026-10-01', // release date → +30d; fill in
    event_selectors: [{event: 'template_offer_shown'}, {event: 'template_offer_clicked'}, {event: 'template_created'}, {event: 'template_create_failed'}, {event: 'template_offer_dismissed'}]})
  .filter(function(e) { return !isInternal(e.properties.client_domain) && e.properties.product_type === 'lite'; })
  .groupBy(['name', function(e) { return e.properties.client_domain + '/' + e.properties.confluence_space; }, function(e) { return String(e.properties.failure_reason); }], mixpanel.reducer.count())
  .groupBy([function(r) { return r.key[0] + '|' + r.key[2]; }], mixpanel.reducer.count()); // distinct spaces per step
}
```

```sql
-- docs/analysis/2026-08-22-lite-activation-priority/readout-t5-d1.sql — 90-day leverage
-- New Lite authorIds per space in the 90 days AFTER vs BEFORE the release date.
-- Run: npx wrangler d1 execute conf-zenuml-prod --env production --remote --json --command "$(cat readout-t5-d1.sql)"
-- Replace <RELEASE> with the release date (YYYY-MM-DD). Join the template spaces by
-- spaceId from the Mixpanel confluence_space → spaceId map (private/).
WITH first_seen AS (
  SELECT v.authorId, c.spaceId, MIN(c.createdAt) firstAt
  FROM CustomContentVersion v JOIN CustomContent c ON c.contentId = v.contentId
  WHERE c.appId = '8ad26115-211f-4216-971b-0540f606303d'
  GROUP BY v.authorId, c.spaceId
)
SELECT spaceId,
  SUM(firstAt >= date('<RELEASE>', '-90 days') AND firstAt < '<RELEASE>') AS new_authors_before_90d,
  SUM(firstAt >= '<RELEASE>' AND firstAt < date('<RELEASE>', '+90 days')) AS new_authors_after_90d
FROM first_seen GROUP BY spaceId;
```

Go/no-go (spec row T5): ≥ 7 spaces created a template within 30 days AND 90-day `new_authors_after_90d ≥ 2 × new_authors_before_90d` on those spaces → extend the band (85–99 first; ≥ 100 only after the paywall interaction is designed). < 4 created → stop. Created but no difference → "template is not a lever".

- [ ] **Step 3: Release** — user-gated. Hand over: PR label, user-visible change (space admins of 50–84-diagram Lite spaces see a one-row banner offering a "Diagram page" template; one click creates it in their space), rollback (revert PR; created templates stay in tenants' spaces — they are ordinary Confluence templates the admin can delete).

- [ ] **Step 4: Post-release spot check (never skipped)** — on an internal Lite site, set the two markers as in Task 6, reload, create the template, create a page from it, open the macro editor, publish; confirm `template_created` and a `macro_create_succeeded` for that account in Mixpanel.

- [ ] **Step 5: Deviation log** — every departure from this plan goes to `docs/analysis/2026-08-22-lite-activation-priority/deviation-log.md`.

---

## Self-review

1. **Spec coverage** — decision 5 (T5 path b, spike first): Tasks 0, 2, 3. Decision 6 (50–84 band, 74 spaces): Task 4 band constants. Decision 10 (events first): Task 1. Decision 12 (thresholds ≥ 7 / < 4): Task 7 step 2. `forge-template-feasibility.md` correction (no scope change): Global Constraints + Task 3 comment. Go/no-go row T5 (30-day create count, 90-day D1 leverage, no randomised holdout): Task 7 queries.
2. **Placeholders** — none; the two localStorage key prefixes in Task 6 are explicitly to be copied from the named source functions, and `<RELEASE>` in the SQL is an input parameter.
3. **Type consistency** — `TemplateCreateError.reason` values (`forbidden | bad_request | network | unexpected`) match `failure_reason` strings asserted in Task 5; `AdfDoc` from Task 2 is the type Task 3 accepts; `isInTemplateOfferBand` / `isTemplateOfferSuppressed` / `markTemplateCreated` / `markTemplateOfferDismissed` / `readTemplateOfferMarker` are spelled identically in Tasks 4, 5; `PageBannerChoice` `'template-offer'` matches the `handlePageBannerRoute` branch and the spec assertions.
