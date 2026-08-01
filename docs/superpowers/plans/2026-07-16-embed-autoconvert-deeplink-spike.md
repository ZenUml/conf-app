# Embed AutoConvert Deeplink Spike — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove end-to-end that a copied ZenUML deeplink (`https://confluence.zenuml.com/d/<cloudId>/<contentId>`), pasted into the Confluence editor, auto-converts into the existing **Embed macro** and renders the referenced diagram — closing the "create in library → place on page" gap without ever writing the page body (the ADF-insertion trap).

**Architecture:** Forge macro `autoConvert` matchers (confirmed in the Forge macro manifest reference, 2026-07-16: `autoConvert.matchers[].pattern`, `*` = one path segment, matched URL surfaces as `autoConvertLink` in the extension context) on the existing `zenuml-embed-macro` module. The embed viewer already resolves diagrams by `context.extension.config.customContentId` (`src/forge-embed-viewer.ts:15`); the spike adds a fallback that derives `customContentId` from `autoConvertLink`. All work deploys to the **personal Forge development env only**.

**Tech Stack:** Forge manifest (`autoConvert`), Vue/TS Custom UI (`src/forge-embed-viewer.ts`), Vitest, `pnpm forge:*:dev` scripts (forgex wrapper), Confluence Cloud dev site.

**Spike status:** This is a SPIKE. The branch (`spike/embed-autoconvert-deeplink`) is **never merged**. Deliverable = the Findings section of this doc filled in, plus a go/no-go for a productization plan.

## Global Constraints

- **Forge-only** — no `AP.*`, no Connect APIs (`docs/policies/forge-only.md`).
- **Do NOT touch `permissions.scopes`** in `manifest.yml` — module-only changes keep the version bump minor (no admin consent wall).
- **Deploy to the personal development env ONLY** (`FORGE_ENV=development`, lite-dev app). No staging/prod deploys — staging goes via CI/CD only, prod needs explicit approval.
- **Spike branch never merges; no release.** Productization gets its own TDD plan.
- **Client privacy:** findings must not contain real customer tenant names; the dev site name is fine.
- **Deeplink scheme is locked for the spike:** `https://confluence.zenuml.com/d/<cloudId>/<contentId>` — cloudId is the site UUID, contentId is the numeric custom-content id. HTTPS only (no `http` matcher, deliberate).
- **Timebox: 1 day.** If Task 5 (paste test) fails after 3 distinct attempts, stop and write findings — do not rabbit-hole.

## Open Questions This Spike Must Answer

1. **Q1 — Where exactly does the matched URL land?** Docs say "`autoConvertLink` parameter in the extension context"; confirm the precise path (`context.extension.config.autoConvertLink` vs elsewhere) by logging.
2. **Q2 — Does autoconvert fire in the current editor, and in Live Docs?** (Live Docs restrict some macros.)
3. **Q3 — Does the deeplink URL need to resolve?** (Assumption A1: pattern matching is local to the editor; no fetch of the URL is required. The `confluence.zenuml.com/d/...` route does not exist yet — observe whether that degrades anything.)
4. **Q4 — What does a cross-site paste look like?** (Deeplink from another cloudId pasted here: macro inserts but must fail soft.)

---

### Task 0: Environment recon + spike branch

**Files:**
- No source changes. Working dir: `/Users/pengxiao/workspaces/zenuml/conf-app` (or a fresh worktree if `git status` shows another session's changes — see git-workflow policy).

**Interfaces:**
- Produces: a checked-out branch `spike/embed-autoconvert-deeplink`; the dev site hostname (call it `<DEV_SITE>`) and confirmation the dev env deploy pipeline works before any code changes.

- [ ] **Step 1: Confirm Forge identity and dev install**

Run: `forge whoami`
Expected: logged in (if not, see `docs/debugging/forge-cli-auth.md`).

Run: `forge install list -e development`
Expected: one Confluence install row — its site is `<DEV_SITE>` (per personal config this is the lite-dev app; `pnpm forge:deploy:dev` / `forge:install:dev` run through `./scripts/forgex`, which substitutes `FORGE_ENV` / `ATLASSIAN_SITE` from personal config).

- [ ] **Step 2: Create the spike branch**

```bash
git fetch origin main
git checkout -b spike/embed-autoconvert-deeplink origin/main
pnpm install
```

- [ ] **Step 3: Baseline build + deploy (unchanged code)**

Run: `pnpm forge:all:dev`  (= `build:lite` + `forge:deploy:dev` + upgrade)
Expected: deploy succeeds, version reported. This proves any later failure is caused by the spike change, not the pipeline.

---

### Task 1: Deeplink parser (TDD)

**Files:**
- Create: `src/utils/embedDeeplink.ts`
- Test: `src/utils/embedDeeplink.spec.ts` (co-located, matching `src/components/Viewer/ForgeEmbedViewer.spec.ts` convention)

**Interfaces:**
- Produces: `parseEmbedDeeplink(url: string): { cloudId: string; contentId: string } | undefined` — consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

```ts
// src/utils/embedDeeplink.spec.ts
import { describe, it, expect } from 'vitest';
import { parseEmbedDeeplink } from './embedDeeplink';

const CLOUD = '494a0c9e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

describe('parseEmbedDeeplink', () => {
  it('parses a canonical deeplink', () => {
    expect(parseEmbedDeeplink(`https://confluence.zenuml.com/d/${CLOUD}/123456789`))
      .toEqual({ cloudId: CLOUD, contentId: '123456789' });
  });

  it('tolerates trailing slash, query and fragment', () => {
    expect(parseEmbedDeeplink(`https://confluence.zenuml.com/d/${CLOUD}/42/?utm=x#top`))
      .toEqual({ cloudId: CLOUD, contentId: '42' });
  });

  it('rejects http, foreign hosts, and malformed paths', () => {
    expect(parseEmbedDeeplink(`http://confluence.zenuml.com/d/${CLOUD}/42`)).toBeUndefined();
    expect(parseEmbedDeeplink(`https://evil.example.com/d/${CLOUD}/42`)).toBeUndefined();
    expect(parseEmbedDeeplink('https://confluence.zenuml.com/d/42')).toBeUndefined();
    expect(parseEmbedDeeplink(`https://confluence.zenuml.com/d/${CLOUD}/not-numeric`)).toBeUndefined();
    expect(parseEmbedDeeplink('')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test:unit -- src/utils/embedDeeplink.spec.ts`
Expected: FAIL — `Cannot find module './embedDeeplink'` (or equivalent).

- [ ] **Step 3: Write the minimal implementation**

```ts
// src/utils/embedDeeplink.ts
// Deeplink shape is locked by the autoConvert matcher in manifest.yml:
//   https://confluence.zenuml.com/d/<cloudId>/<contentId>
// cloudId = site UUID; contentId = numeric Confluence custom-content id.
export interface EmbedDeeplink {
  cloudId: string;
  contentId: string;
}

const DEEPLINK_RE =
  /^https:\/\/confluence\.zenuml\.com\/d\/([0-9a-fA-F-]{32,36})\/(\d+)\/?(?:[?#].*)?$/;

export function parseEmbedDeeplink(url: string): EmbedDeeplink | undefined {
  const m = DEEPLINK_RE.exec((url || '').trim());
  return m ? { cloudId: m[1].toLowerCase(), contentId: m[2] } : undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test:unit -- src/utils/embedDeeplink.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/utils/embedDeeplink.ts src/utils/embedDeeplink.spec.ts
git commit -m "spike(embed): deeplink parser for autoconvert URLs"
```

---

### Task 2: Manifest autoConvert matcher on the Embed macro

**Files:**
- Modify: `manifest.yml:229-242` (the `zenuml-embed-macro${LITE_KEY_SUFFIX}` module)

**Interfaces:**
- Produces: pasting `https://confluence.zenuml.com/d/*/*` in the editor inserts the Embed macro; the matched URL reaches the iframe (exact context path confirmed in Task 5 / Q1).

- [ ] **Step 1: Add the matcher to the embed macro module**

In `manifest.yml`, the embed macro module currently ends like this (line ~229):

```yaml
    - key: zenuml-embed-macro${LITE_KEY_SUFFIX}
      title: Embed a Diagram, Graph or API Spec${LITE_TITLE_SUFFIX}
      description: Embed an existing Diagram, Graph or API Spec. ${APP_LABEL}
      resource: main
      config:
        resource: main
        viewportSize: fullscreen
      adfExport:
        function: exportMacro
      resolver:
        endpoint: remote-connect
      icon: resource:main;image/diagram_macro_icon.png
      unlicensedAccess:
        - unlicensed
```

Add `autoConvert` at the same indent level as `icon` (one pattern; each `*` matches exactly one path segment per the Forge docs, so `/d/<cloudId>/<contentId>` needs two):

```yaml
      autoConvert:
        matchers:
          - pattern: https://confluence.zenuml.com/d/*/*
```

- [ ] **Step 2: Deploy to the dev env**

Run: `pnpm forge:all:dev`
Expected: deploy succeeds. Note the reported version in the findings — module-only change must be a **minor** bump (if the CLI reports a major-version warning, STOP and record it: that alone is a go/no-go input).

- [ ] **Step 3: Commit**

```bash
git add manifest.yml
git commit -m "spike(embed): autoConvert matcher for confluence.zenuml.com deeplinks"
```

---

### Task 3: Viewer fallback — derive customContentId from autoConvertLink

**Files:**
- Modify: `src/forge-embed-viewer.ts:11-26` (`loadDiagram()`)

**Interfaces:**
- Consumes: `parseEmbedDeeplink` from Task 1.
- Produces: an Embed macro inserted via autoconvert renders the referenced diagram with zero manual configuration; a `[spike]` console log revealing the real extension-context shape (answers Q1).

- [ ] **Step 1: Modify `loadDiagram()`**

Replace lines 11–26 of `src/forge-embed-viewer.ts` (imports at top of file gain one line):

```ts
import { parseEmbedDeeplink } from '@/utils/embedDeeplink';
```

```ts
async function loadDiagram(): Promise<Diagram | undefined> {
  const context = await initForgeContext();

  // [spike] Q1: observe exactly where the autoconverted URL lands.
  console.log('[spike] extension context', JSON.stringify(context.extension));

  let doc: Diagram | undefined;
  let customContentId = context.extension?.config?.customContentId;
  const pageId = context.extension?.content?.id;

  // Autoconvert fallback: a pasted deeplink arrives with no saved config —
  // derive the target from the matched URL instead.
  if (!customContentId) {
    const link = context.extension?.config?.autoConvertLink
      ?? (context.extension as any)?.autoConvertLink; // Q1: docs are ambiguous on the path
    const deeplink = link ? parseEmbedDeeplink(link) : undefined;
    if (deeplink) {
      if (context.cloudId && deeplink.cloudId !== String(context.cloudId).toLowerCase()) {
        // Q4: foreign-site paste — fail soft, never fetch cross-tenant.
        console.warn('[spike] deeplink cloudId mismatch', deeplink.cloudId, context.cloudId);
      } else {
        customContentId = deeplink.contentId;
      }
    }
  }

  if (!customContentId) {
  } else {
    const customContent = await globals.apWrapper.getCustomContentByIdV2(customContentId);
    console.log('loadDiagram - customContent', customContent);
    doc = customContent?.value;
    if (!doc) {
      // ZEN-1170 telemetry: probe page children for a recovery candidate.
      void reportOrphanObserved(globals.apWrapper, context.extension?.content?.id, customContentId, 'embed');
    }
  }
```

(The legacy `uuid` recovery block below this — lines 28–49 — stays untouched.)

- [ ] **Step 2: Verify existing tests still pass and the build compiles**

Run: `pnpm test:unit -- src/components/Viewer/ForgeEmbedViewer.spec.ts src/utils/embedDeeplink.spec.ts`
Expected: PASS.

Run: `pnpm build:lite`
Expected: build succeeds. (Typecheck baseline is known-red repo-wide — compare errors to main before blaming the spike; the touched files must add no new errors.)

- [ ] **Step 3: Deploy and commit**

```bash
pnpm forge:all:dev
git add src/forge-embed-viewer.ts
git commit -m "spike(embed): render diagram from autoConvertLink deeplink"
```

---

### Task 4: Mint a real deeplink on the dev site

**Files:** none (evidence-gathering).

**Interfaces:**
- Produces: `<DEEPLINK>` = `https://confluence.zenuml.com/d/<cloudId>/<contentId>` pointing at a real diagram on `<DEV_SITE>`, used by Tasks 5–6.

- [ ] **Step 1: Get the site cloudId**

Open `https://<DEV_SITE>/_edge/tenant_info` in the logged-in browser.
Expected: JSON `{"cloudId":"<uuid>"}` — record it.

- [ ] **Step 2: Pick a target diagram and capture its customContentId**

Open any existing page on `<DEV_SITE>` that contains a ZenUML sequence macro in **view mode** (create one first via the normal editor flow if none exists). In DevTools → Network, filter `custom-content`; the viewer issues `GET .../custom-content/<id>` — record `<id>` as the contentId. (This is the same id the embed viewer feeds to `getCustomContentByIdV2` — `src/forge-embed-viewer.ts:19`.)

- [ ] **Step 3: Compose and record the deeplink**

`<DEEPLINK>` = `https://confluence.zenuml.com/d/<cloudId>/<contentId>` — paste it into the Findings section.

---

### Task 5: The paste test (the spike's moment of truth)

**Files:** none (evidence-gathering; screenshots into the Findings section).

- [ ] **Step 1: Paste into a normal page**

On `<DEV_SITE>`: create a new page → in the editor body, paste `<DEEPLINK>` (plain Cmd+V).
Expected (GO signal): the pasted link converts into the Embed macro placeholder. Screenshot it.
If it stays a plain smart link: retry with the editor's paste-options popup (if one appears), then with a fresh editor session. After 3 distinct attempts, record FAIL + exact behavior and move to Task 7 — this is the spike's central falsifiable claim.

- [ ] **Step 2: Publish and verify render**

Publish the page → view mode.
Expected: the macro renders the target diagram identically to a hand-configured Embed macro. Screenshot it.
In DevTools console, find the `[spike] extension context` log and record the **exact JSON path** where the URL appears (answers Q1) and whether `[spike]` shows the deeplink parse succeeding.

- [ ] **Step 3: Editor re-open sanity**

Re-edit the page, confirm the macro survives (no config UI required), republish.
Expected: still renders. Record whether the URL is persisted in macro parameters (visible in the `[spike]` log on second load) — this answers the derive-vs-persist productization question (Q1 follow-on).

- [ ] **Step 4: Live Doc check (Q2)**

If `<DEV_SITE>` offers Live Docs: repeat Step 1 in a Live Doc; record convert/render behavior. If Live Docs are unavailable on the site, record **UNTESTED — site has no Live Docs** (do not extrapolate).

---

### Task 6: Negative paths

**Files:** none (evidence-gathering).

- [ ] **Step 1: Foreign-site deeplink (Q4)**

Paste `https://confluence.zenuml.com/d/00000000-0000-4000-8000-000000000000/999999` into a page.
Expected: macro inserts (pattern matches), viewer logs the cloudId-mismatch warning and renders the existing empty/error state — record exactly what the user sees (this defines the "diagram lives on another site" card requirement for productization).

- [ ] **Step 2: Near-miss URLs**

Paste `http://confluence.zenuml.com/d/<cloudId>/<contentId>` (http) and `https://confluence.zenuml.com/d/<contentId>` (one segment).
Expected: NO conversion — they remain ordinary links. Record any surprise.

- [ ] **Step 3: Unresolvable-URL degradation (Q3 / A1)**

While `confluence.zenuml.com/d/...` returns 404 (no landing route exists yet), note whether the editor showed any broken-preview artifact at paste time in Tasks 5–6.
Expected: none — conversion is local pattern matching. Record the observation either way.

---

### Task 7: Findings + go/no-go

- [ ] **Step 1: Fill in the Findings section below** (in THIS file, on `main` — .md-only edits go straight to main).

- [ ] **Step 2: Commit the findings**

```bash
git add docs/superpowers/plans/2026-07-16-embed-autoconvert-deeplink-spike.md
git commit -m "docs(spike): embed autoconvert findings + go/no-go"
git push origin main
```

- [ ] **Step 3: Leave the spike branch unmerged** — push it for reference only:

```bash
git push -u origin spike/embed-autoconvert-deeplink
```

---

## Findings (executed 2026-07-16, lite-dev, spike branch @ cda5c537, deployed as 16.118.0)

| Question | Answer | Evidence |
|---|---|---|
| Q1 — exact context path of the matched URL | The URL is **persisted in the page ADF** as `parameters.autoConvertLink` on the extension node, alongside `hasBeenAutoConverted: true` — it reaches the iframe via the macro's extension config/params, and it survives forever in the page body (derive-per-render is durable; **no config write needed**) | ADF dump of page 46956548 (v2 API, `body-format=atlas_doc_format`) |
| Q2 — converts in current editor? in Live Docs? | **Both YES.** New editor: paste → instant conversion to "Embed a Diagram, Graph or API Spec Lite" placeholder. **Live Doc: converts AND renders the full diagram inline immediately** (live-doc autosave) | screenshots `spike-after-paste.png`, `spike-livedoc-paste.png` |
| Q3 — unresolved URL degrades paste? | **No.** `confluence.zenuml.com/d/...` 404s today; conversion was instant and visual-clean — pattern matching is editor-local, no fetch of the URL | observation during Tasks 5–6 |
| Q4 — foreign-site paste user experience | Macro inserts (pattern matches), viewer fails soft with the existing red message "This embedded diagram couldn't be loaded… Edit the macro to pick a different diagram." No crash, no cross-tenant fetch (cloudId guard). Productization: replace copy with "lives on another Confluence site" | screenshot `spike-foreign-paste.png` |
| Version bump on deploy (must be minor) | **Minor** — 16.118.0 (16.x line continued); manifest validation passed with `autoConvert` | `forge deploy` output |
| Paste → render round-trip works end to end | **YES.** Deeplink `https://confluence.zenuml.com/d/bc8bb5b3-…/425987` pasted → autoconverted → published → renders the target sequence diagram ("AAA"/Order Service); debug chip shows the spike build (`spike/embed-aut…@1f8ea3…`) | screenshots `spike-published-view.png` |
| Bonus — near-miss URLs | `http://` and single-segment `/d/<id>` do NOT convert (stay plain links) — matcher is exact | screenshot `spike-negative-paths.png` |

**Execution notes / deviations:**
- **forge tunnel caveat:** functions bundled and invocations flowed, but Custom UI resource serving failed (`Error: AggregateError` loop; macro iframes stuck on spinner while tunnelled). Killed the tunnel and verified against the **deployed** development build — same spike code, so no evidence lost. Investigate tunnel resource serving separately before relying on it for Custom UI iteration.
- **Automation artifact:** a synthesized Cmd+V through the Playwright extension relay does not trigger native paste; the paste was delivered as a synthetic `ClipboardEvent` on the ProseMirror root (`defaultPrevented=true` — the editor consumed it). A human Cmd+V is the same event path; not a product concern.
- Editor identity was eagle.xiao (tunnel-eligible account) throughout; site cloudId `bc8bb5b3-09d2-4932-b68c-9b56fab8e34a` confirmed via `/_edge/tenant_info`.

**Go/no-go:** ☑ **GO** — draft the productization plan ☐ NO-GO.

## Productization backlog (NOT this spike — feeds the next plan if GO)

- Persist the parsed `customContentId` into macro config on first render (survives link-scheme changes) vs derive-per-render — decide with Q1/Step-3 evidence.
- Proper foreign-site card ("This diagram lives on another Confluence site").
- Hub/viewer **Copy link** affordance (concierge prototype already stages this UX).
- `confluence.zenuml.com/d/<cloudId>/<contentId>` landing route on Cloudflare Pages (redirect into Confluence + OG preview).
- Analytics (register in `src/utils/analytics/catalog.ts` + `types.ts` as the productization branch's first commit): `embed_autoconvert_rendered`, `embed_autoconvert_foreign_site`, `deeplink_copied` — with `source`, `macro_type`, `match` properties.
- Lite quota semantics: does an embed-by-paste count toward the 100-macro space limit? Decide before GA.
- Roll out matcher to full/diagramly/asyncapi manifests (asyncapi also has `zenuml-asyncapi-embed-macro`, `manifest.yml:265`).

---

## Follow-on spike: paste-to-CREATE (`/new/<type>`) — 2026-08-01

Same mechanism, different job. The embed spike converted a link to an
**existing** diagram; this converts a link into a **new, empty** diagram of a
chosen type, so the Lite byline type picker can place a macro at the user's
cursor. Nothing else can: there is no API that inserts a macro into the editor
from another iframe, and Atlassian's own guidance for programmatic-feeling
insertion is paste-autoconvert.

**Built (branch `claude/byline-lite-app-growth-dx2r3s`, deployed to lite-stg by CI):**

- `manifest.yml` — `autoConvert.matchers` on the three creation macros:
  sequence family (`/new/sequence`, `/new/mermaid`, `/new/plantuml`),
  `zenuml-openapi-macro` (`/new/openapi`), `zenuml-graph-macro` (`/new/graph`).
  Literal patterns, https only — the manifest reference allows a fully literal
  URL and requires a separate matcher per protocol.
- `src/utils/newDiagramLink.ts` — build/parse the link, plus
  `readAutoConvertLink()`, which reads **three** candidate context paths
  (`extension.config`, `extension`, `extension.parameters`) precisely because
  the exact one is what this spike has to confirm; reading a single guessed path
  and getting it wrong would be indistinguishable from "autoConvert never
  fired". 13 unit tests.
- `src/forgeIndex.ts` — seeds a blank macro's `diagramType` from the link,
  gated on `!doc && !customContentId` so an existing diagram's own type always
  wins.
- `BylineDiagrams.vue` — a type tile copies the link before routing to the
  editor, and the hero copy now says what actually happens rather than
  promising the macro is pre-placed.

**Findings (paste executed on lite-stg, 2026-08-01):**

| Question | Answer | Evidence |
|---|---|---|
| Does `/new/<type>` convert into the right macro? | **YES** — pasting `https://confluence.zenuml.com/new/mermaid` produced a ZenUML macro in the editor | user paste on lite-stg |
| Does `autoConvertLink` reach the iframe, and at which path? | **YES**, and `readAutoConvertLink`'s first candidate is sufficient — the link parsed and seeded on the paths that reached the seeding code | Mixpanel `new_diagram_link_seeded`: `graph` ×2, `OpenAPI` ×1 on lite-stg |
| Does the seeded type stick? | **NO for the sequence family, YES for graph/openapi** — `/new/mermaid` opened as a sequence diagram. Cause: the seeding guard tested `!doc`, but forgeIndex assigns the sequence family a placeholder doc (diagramType Sequence, example bodies pre-filled) *before* that point, so the guard was already false for exactly the family this feature targets. graph/openapi leave `doc` undefined and seeded correctly. | absence of a `mermaid` row in the same Mixpanel query is the discriminator |

Fixed by gating on `!customContentId` (a macro with nothing stored) instead of
`!doc`, and by flipping the placeholder's `diagramType` rather than replacing
the doc — the placeholder already carries the mermaid/plantuml example bodies
and the `isNew` flag. The guard now lives in a unit-tested
`applyNewDiagramLink()` rather than inline in forgeIndex, since the guard is
what was wrong.

**Still to confirm on the next paste:**

1. `/new/mermaid` and `/new/plantuml` now open in the right type (the fix above).
2. Conversion inside a **Live Doc** (the embed spike proved it for its own pattern).
3. Does the converted macro open its editor directly, or insert a placeholder
   the user must then click?
4. Version bump stays **minor** (the embed matcher deploy was 16.118.0). Confirm
   from `forge deploy` output.

**Do not merge to `main` on the strength of the code alone** — this is spike
scope. Two productization questions are already open from the embed spike and
apply here unchanged: whether a pasted macro counts toward the Lite 100-macro
limit, and how the paywall gate applies to a create path that never passes
through our editor's save flow.
