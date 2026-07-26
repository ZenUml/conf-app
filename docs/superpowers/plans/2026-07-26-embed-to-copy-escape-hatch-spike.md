# Embed → Editable Copy Escape Hatch — Spike Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine whether an embed macro can become an **editable, independent** diagram — and at what cost. This is Phase 0 of `2026-07-26-embed-deeplink-productization.md`; its result sets **Gate A**, which decides what a pasted deeplink produces.

**Why this blocks:** the only argument for "paste produces an embed" is that an embed is *reversible* (it can become a copy; a copy can never become a reference). If the reverse path doesn't exist at acceptable cost, that argument collapses and the default should flip to clone, because a clone is at least always editable. One spike, one design-level consequence.

**Revision 2026-07-26 (desk pass, before any execution):** Q1 was answered statically and the answer eliminated two of the three original mechanisms. See "Desk findings" below — this doc has been restructured around what survived.

---

## Desk findings (2026-07-26, no environment touched)

### D1 — `view.submit`'s payload is unconstrained by the SDK; Q1 is not statically answerable

- `@forge/bridge@5.16.0` types it as `submit: (payload?: any) => Promise<void>` (`out/view/submit.d.ts:1`). `any` neither permits nor forbids an `extensionKey` — **a clean `tsc` run proves nothing here.**
- The SDK is a pure pass-through: `callBridge('submit', payload)` with no client-side shaping (`out/view/submit.js`). Whatever is accepted is decided by the Confluence host, which is not in `node_modules`.
- Nothing in `@forge/bridge` or `@forge/manifest` mentions `extensionKey`.
- **All six** `submit` call sites in this repo pass only `{config: {...}}` — `forge-embed-editor.ts:120`, `forge-swagger-editor.ts:190`, `forge-graph-editor.ts:162`, `forgeIndex.ts:1161`, `forge-asyncapi-editor.ts:180`, `forge-asyncapi-embed-editor.ts:35`. No prior art of anything else.

### D2 — `view.submit` only works in the page-editor config surface, and this has bitten us twice

This is the finding that restructures the spike. Documented independently in three places in our own code:

| Source | What it says |
|---|---|
| `src/model/asyncapi/resolveEditorEntry.ts:12-24` | "changing a macro's config is only possible where `view.submit()` is submittable — the native page-editor config gesture (`macro.isInserting` / `macro.isConfiguring`). The view-mode 'Edit' affordance opens a Forge *modal* (`modal.macroMode === 'editor'`) where `view.submit()` throws 'this resource's view is not submittable'." |
| `src/components/Viewer/GenericViewer.vue:322` | "Our in-viewer Edit opens a modal where `view.submit({config})` can't persist back to the macro — saves would silently create orphans" |
| `src/model/Diagram/Diagram.ts:50` | "The in-viewer Edit button is gated off because `view.submit({config})` in the modal flow doesn't persist back to the macro XML" |

Two shipped bugs already came from this: the asyncapi embed picker was routed to the view-mode modal and **every** re-target hit the throw ("Failed to embed document. Please try again.", no way to save); and ZEN-1170 Defect 2b had to *disable* the in-viewer Edit button for orphan-recovered diagrams and steer users to "click Edit on the page (top right), then click Edit on this macro."

**Consequence:** any mechanism that writes macro **config** or the page **ADF** can only run from the native page-editor surface. The user journey becomes: enter page edit mode → open the macro config → act → publish the page. That is **≥3 actions plus a full page publish**, which fails Gate A criteria 1 and 2 *by construction* — no experiment needed.

### D3 — what this eliminates

| | Mechanism | Verdict |
|---|---|---|
| ~~**A**~~ | `view.submit` changes the extension key | **Dead on criteria 1–2** regardless of whether the host accepts `extensionKey`. Inherits D2's surface constraint. Q1's live test is now moot. |
| ~~**B**~~ | Fork the content, repoint `config.customContentId` | **Dead on criteria 1–2.** The repoint is a config write. Inherits D2. |
| ~~**C**~~ | Replace the extension node in the page ADF | **Dead on criteria 1–2**, and worse: rewriting customer page bodies under the app's identity, racing concurrent human edits. |
| **B′** | Fork the content and record the override in a **viewer-writable** store, keyed to the macro — never touching config or ADF | **The only survivor.** This is what the spike now tests. |

**B′ is plausible because the viewer *can* write custom content** (`ApWrapper2.saveCustomContentV2` / `createCustomContentV2`; the agent-link feature already persists diagram writes from the viewer surface), and the embed viewer already has a non-config resolution path — the legacy `uuid` recovery block in `src/forge-embed-viewer.ts:28-49`, plus `parameters.autoConvertLink` for pasted embeds. An override keyed on the macro's `localId`/`uuid` would slot into the same resolution chain.

**B′ is not free**, and the spike must price these, not wave at them:
- It is a **shadow persistence layer the page ADF knows nothing about**. Copy the page, and the override either follows or doesn't (`localId` is measured to survive whole-page copy — so the fork would be *shared* by the copy, which may be wrong).
- Delete the macro and the forked content orphans — straight into the `customcontent_orphan_observed` surface we already have pain in.
- The `EMBED` chip and the embed macro's picker-only editor still describe a reference, not a copy (criterion 5, criterion 3).

---

## Gate A acceptance criteria — FIXED BEFORE RUNNING

`REVERSIBLE` requires **all five**. Any failure ⇒ `NOT REVERSIBLE`. Written down up front so the verdict is not rationalised against whatever the implementation turns out to cost.

1. **≤ 2 user actions** from the blocked Edit click to an editable copy.
2. **No extra page publish** beyond the one a normal macro edit already requires.
3. The result is editable in the **normal DSL editor** — the user can change the code, not just re-pick a target.
4. The **source diagram is unmodified** (verify its `latestVersionNumber` is unchanged).
5. **The chrome does not lie** — no `EMBED` chip (`GenericViewer.vue:25`) left on something that is no longer a reference.

## Global Constraints

- **Forge-only** — no `AP.*`, no Connect APIs (`docs/policies/forge-only.md`).
- **Do NOT touch `permissions.scopes`** — module-only changes stay a minor bump.
- **Deploy to the personal development env ONLY** (`FORGE_ENV=development`, lite-dev). No staging/prod deploys.
- **Spike branch never merges; no release.** No analytics events — a spike that never ships needs none.
- **Client privacy:** findings must not contain real customer tenant names; the dev site name is fine.
- **Timebox: half a day** (was one day; D1–D3 removed three of four questions). Stop after 3 distinct attempts on Q2, record the failure, write findings. A NO is a finding, not a failure.

## Open Questions — what is actually left

1. **Q2 (the whole spike)** — does Mechanism B′ produce something that passes all five Gate A criteria, and what does its shadow-persistence cost look like in practice?
2. **Q4 (independent, 5 minutes)** — does `Cmd+Z` immediately after autoconvert revert to a plain link? autoConvert takes over the paste with no Confluence-native URL/inline/card switcher, so undo is the only escape at paste time. Does not gate Gate A; it is a productization copy/UX input.

*(Q1 answered on the desk — see D1/D3. Q3 moot — see D3.)*

---

### Task 0: Environment recon + spike branch

**Files:** none. Working dir: `/Users/pengxiao/workspaces/zenuml/conf-app` (fresh worktree if `git status` shows another session's changes — see git-workflow policy).

**Interfaces:**
- Produces: branch `spike/embed-to-copy-escape-hatch`; confirmation the dev deploy pipeline is green **before** any code change, so a later failure is attributable to the spike.

- [ ] **Step 1: Confirm Forge identity and dev install**

Run: `forge whoami` — expected: logged in (else `docs/debugging/forge-cli-auth.md`).
Run: `forge install list -e development` — expected: one Confluence install; record the site as `<DEV_SITE>`.

- [ ] **Step 2: Branch from the autoconvert spike, not from main**

Q2 and Q4 both need a working paste→embed flow, which only exists on the earlier spike branch.

```bash
git fetch origin
git checkout -b spike/embed-to-copy-escape-hatch origin/spike/embed-autoconvert-deeplink
pnpm install
```

- [ ] **Step 3: Baseline deploy (unchanged code)**

Run: `pnpm forge:all:dev`
Expected: deploy succeeds; record the version.

- [ ] **Step 4: Stage the fixtures**

On `<DEV_SITE>`: a page **S** holding a real sequence diagram (the source), and a page **T** (the target, empty). Record the source's `customContentId` and its current `latestVersionNumber` — criterion 4 is checked against it.

---

### Task 1: Q4 — paste undo (first; 5 minutes, independent)

**Files:** none (evidence-gathering).

- [ ] **Step 1: Paste and undo**

On page **T**, paste a valid deeplink → it autoconverts to the embed macro placeholder. Immediately press `Cmd+Z`.
Expected (record whichever happens): reverts to a plain link / reverts to nothing / leaves the macro in place.

**Automation caveat (from the 2026-07-16 spike):** a synthesized `Cmd+V` through the Playwright extension relay does **not** trigger native paste. Deliver a synthetic `ClipboardEvent` on the ProseMirror root, or do this step by hand. Never record a UI observation you did not actually see.

- [ ] **Step 2: Repeat after a publish cycle**

Publish, re-edit, confirm the macro can still be removed the ordinary way (select + delete). Screenshot both.

---

### Task 2: Q2 — Mechanism B′, fork + viewer-writable override

The whole spike. Mechanisms A, B and C are already dead on the desk (D3) — **do not spend time re-testing them.**

**Files:**
- Modify: `src/forge-embed-viewer.ts` (resolution chain: override → `config.customContentId` → `autoConvertLink` → legacy `uuid`)
- Modify: `src/components/Viewer/GenericViewer.vue` (temporary "Make an editable copy" affordance on the blocked Edit, to measure criterion 1)
- Reference: `src/model/ApWrapper2.ts` — `getCustomContentByIdV2` (`:504`), `createCustomContentV2` (`:295`), `saveCustomContentV2` (`:1464`)

**Interfaces:**
- Produces: a pasted embed turned into an independently editable diagram **without any config or ADF write** — or a specific, named blocker.

- [ ] **Step 1: Pick the override key and prove the viewer can write it**

Candidate keys: the macro's `localId`, or the embed's existing `uuid`. Whichever is chosen, first prove the viewer surface can **write** a record keyed by it and **read it back on the next render** — before building anything on top.

Expected: a round trip that survives a page reload. If the viewer cannot persist a keyed override at all, Q2 is answered NO here and the spike is over — go to Task 3.

- [ ] **Step 2: Fork the source content**

From the viewer, read the source custom content and create a new one from its body under the **current** page as parent; record the fork's id in the override.

Expected: the macro renders the fork. **Check criterion 4 immediately** — the source's `latestVersionNumber` must be unchanged.

- [ ] **Step 3: Make it editable (criterion 3)**

The embed macro's editor is the picker (`ForgeEmbedEditor.vue` = `<DocumentList />`). Determine whether a macro carrying a fork override can route to the normal DSL editor instead — and whether that routing decision is even available in the surface the user reaches from the viewer.

Expected: the user changes the code, publishes, the change renders, the source is still untouched. **If the DSL editor is only reachable through the page-editor surface, criterion 3 fails and Gate A is NOT REVERSIBLE** — record it and stop.

- [ ] **Step 4: Check the chrome (criterion 5)**

The `EMBED` chip comes from `isEmbedded` (`GenericViewer.vue:25`). Record whether it can be suppressed for a forked macro **without** a page ADF change.

- [ ] **Step 5: Price the shadow layer**

Do not skip this for a green result. Record concretely:
- **Page copy** — `localId` is measured to survive whole-page copy, so a copied page's macro would resolve the *same* override and share the fork. Is that acceptable, or a data-integrity bug?
- **Macro delete** — the forked content orphans. How does that interact with `customcontent_orphan_observed` and the existing recovery paths?
- **Lite quota** — does the fork count toward the 100-macro space limit? (Feeds Gate B in the productization plan.)

- [ ] **Step 6: Count the cost against all five criteria and commit**

```bash
git commit -am "spike(embed): fork + viewer-writable override escape hatch"
```

---

### Task 3: Findings + Gate A

- [ ] **Step 1: Fill the Findings table below** (`.md`-only edits go straight to `main`).

- [ ] **Step 2: Set Gate A in the productization plan**

Edit `2026-07-26-embed-deeplink-productization.md` → the "Gate A result" line and the decisions log.

If **NOT REVERSIBLE**, also apply its stated consequences: paste produces a clone; its Task 5 (escape hatch) is deleted with the reason recorded; its Task 3 is rewritten to fork on first render.

- [ ] **Step 3: Commit findings; push the branch unmerged for reference**

```bash
git add docs/superpowers/plans/2026-07-26-embed-to-copy-escape-hatch-spike.md \
        docs/superpowers/plans/2026-07-26-embed-deeplink-productization.md
git commit -m "docs(spike): embed-to-copy findings + Gate A"
git push origin main
git push -u origin spike/embed-to-copy-escape-hatch
```

---

## Findings

| Question | Answer | Evidence |
|---|---|---|
| Q1 — `view.submit` can change the extension key? | **MOOT** — not statically answerable (`payload?: any`, SDK is a pass-through), and irrelevant because the mechanism fails criteria 1–2 on D2's surface constraint regardless | `@forge/bridge@5.16.0` `out/view/submit.d.ts:1`, `out/view/submit.js`; all 6 in-repo call sites pass only `{config}` |
| D2 — config writes require the page-editor surface | **CONFIRMED (desk)** — view-mode Edit modal throws "this resource's view is not submittable"; two shipped bugs already caused by it | `resolveEditorEntry.ts:12-24`, `GenericViewer.vue:322`, `Diagram.ts:50` |
| Q2 — B′ (fork + viewer-writable override) passes all five criteria? | | |
| Q3 — ADF node replacement supported? | **MOOT** — fails criteria 1–2 by construction; rewrites customer page bodies under the app identity | D3 |
| Q4 — `Cmd+Z` reverts an autoconverted paste? | | |
| Criterion 1 — ≤2 actions from blocked Edit | | |
| Criterion 2 — no extra publish | | |
| Criterion 3 — normal DSL editor reachable | | |
| Criterion 4 — source `latestVersionNumber` unchanged | | |
| Criterion 5 — no lying `EMBED` chip | | |

**Execution notes / deviations:**

- _(record anything that made the evidence weaker than it looks — e.g. the known `forge tunnel` Custom-UI resource-serving failure from the 2026-07-16 spike; verify against a deployed dev build instead of a tunnel if it recurs)_

**Gate A:** ☐ REVERSIBLE — paste produces an embed, escape hatch ships ☐ NOT REVERSIBLE — paste produces a clone

> Desk evidence already leans NOT REVERSIBLE. Task 2 exists to give B′ a fair, falsifiable run before that is recorded as the verdict — not to confirm a foregone conclusion. If B′ passes all five, the desk lean is wrong and Gate A is REVERSIBLE.

## If NOT REVERSIBLE — what changes downstream

Not a cancellation. The productization plan still ships; three things change:

1. Paste produces an **independent copy**, forked from the source at paste time.
2. The embed macro keeps its existing picker entry point and is not promoted — it stays available for users who explicitly want a live reference.
3. Task 10's flip rule inverts: measure how often users go looking for "keep this in sync with the original" **after** taking a copy, and treat that as the signal to invest in embed instead.
