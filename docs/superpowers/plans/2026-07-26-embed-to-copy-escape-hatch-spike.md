# Embed → Editable Copy Escape Hatch — Spike Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Determine whether an embed macro can become an **editable, independent** diagram — and at what cost. This is Phase 0 of `2026-07-26-embed-deeplink-productization.md`; its result sets **Gate A**, which decides what a pasted deeplink produces.

**Why this blocks:** the only argument for "paste produces an embed" is that an embed is *reversible* (it can become a copy; a copy can never become a reference). If the reverse path doesn't exist at acceptable cost, that argument collapses and the default should flip to clone, because a clone is at least always editable. One spike, one design-level consequence.

**Architecture:** three candidate mechanisms, cheapest first.

| | Mechanism | Where it would happen |
|---|---|---|
| **A** | `view.submit` changes the node's extension **key** from `zenuml-embed-macro${LITE_KEY_SUFFIX}` to `${SEQUENCE_MACRO_KEY}` | macro editor (`src/forge-embed-editor.ts:120`) |
| **B** | Keep the embed macro; fork the source into a **new** custom content, repoint `config.customContentId` at the fork, swap the editor from the picker to the DSL editor | macro editor + `ApWrapper2.createCustomContentV2` (`:295`) |
| **C** | Replace the extension node in the page ADF outright | unknown — the 2026-07-16 spike called this "the ADF-insertion trap" and avoided it without establishing whether it is *unsupported* or merely *unattempted* |

**Tech Stack:** Forge Custom UI (`view.submit`), `manifest.yml`, `src/forge-embed-editor.ts`, `src/components/DrawIoExtension/ForgeEmbedEditor.vue`, `src/model/ApWrapper2.ts`, Vitest, `pnpm forge:*:dev` (forgex wrapper), Confluence Cloud dev site.

**Spike status:** This is a SPIKE. The branch (`spike/embed-to-copy-escape-hatch`) is **never merged**. Deliverable = the Findings section below, filled in, plus Gate A.

## Established facts this spike starts from

Verified 2026-07-26 by reading the code — do not re-derive:

- Macro config is written **only** from the editor surface, via `await (await getView()).submit({config: {...}})` — `src/forge-embed-editor.ts:120`. The viewer has **no** config-write path.
- The embed editor is a **picker only**: `ForgeEmbedEditor.vue` renders `<DocumentList />` and nothing else. It cannot edit DSL.
- The main diagram macro key is `${SEQUENCE_MACRO_KEY}`; the embed macro key is `zenuml-embed-macro${LITE_KEY_SUFFIX}` (`manifest.yml:193`, `:235`).
- An embed save creates **no new CustomContent record** — it only points the macro at an existing one (`saveEmbedAndExit` comment, `src/forge-embed-editor.ts:27`).
- `autoConvertLink` persists in the page ADF as `parameters.autoConvertLink` with `hasBeenAutoConverted: true`, so a pasted embed's target is derivable per render with no config write (2026-07-16 spike, Q1).

## Gate A acceptance criteria — WRITE THIS DOWN BEFORE RUNNING

`REVERSIBLE` requires **all five**. Any failure ⇒ `NOT REVERSIBLE`. Defined up front so the verdict is not rationalised against whatever the implementation turns out to cost.

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
- **Timebox: 1 day.** Per question: stop after 3 distinct attempts, record the failure, move on. A NO on any question is a finding, not a failure.

## Open Questions This Spike Must Answer

1. **Q1 — Mechanism A:** can `view.submit` change the extension **key**, or only the config payload? (Expected NO — confirm rather than assume.)
2. **Q2 — Mechanism B:** does fork + repoint + DSL-editor swap produce something that passes all five Gate A criteria?
3. **Q3 — Mechanism C:** is replacing the extension node from inside a macro genuinely unsupported by the Forge platform, or just unattempted here?
4. **Q4 — Paste undo:** does `Cmd+Z` immediately after autoconvert revert to a plain link? autoConvert takes over the paste with no Confluence-native URL/inline/card switcher, so undo is the only escape at paste time — this is part of whether the default is safe.

---

### Task 0: Environment recon + spike branch

**Files:** none. Working dir: `/Users/pengxiao/workspaces/zenuml/conf-app` (fresh worktree if `git status` shows another session's changes — see git-workflow policy).

**Interfaces:**
- Produces: branch `spike/embed-to-copy-escape-hatch`; confirmation the dev deploy pipeline is green **before** any code change, so a later failure is attributable to the spike.

- [ ] **Step 1: Confirm Forge identity and dev install**

Run: `forge whoami` — expected: logged in (else `docs/debugging/forge-cli-auth.md`).
Run: `forge install list -e development` — expected: one Confluence install; record the site as `<DEV_SITE>`.

- [ ] **Step 2: Branch from the autoconvert spike, not from main**

Mechanism B and Q4 both need a working paste→embed flow, which only exists on the earlier spike branch.

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

### Task 1: Q4 — paste undo (do this first; it is 5 minutes and independent)

**Files:** none (evidence-gathering).

- [ ] **Step 1: Paste and undo**

On page **T**, paste a valid deeplink → it autoconverts to the embed macro placeholder. Immediately press `Cmd+Z`.
Expected (record whichever happens): reverts to a plain link / reverts to nothing / leaves the macro in place.

- [ ] **Step 2: Repeat after a publish cycle**

Publish, re-edit, and check whether the macro can still be removed the ordinary way (select + delete). Screenshot both.

Record in Findings. **This does not gate the spike** — it is a productization copy/UX input either way.

---

### Task 2: Q1 — can `view.submit` change the extension key?

**Files:**
- Modify: `src/forge-embed-editor.ts` (the `submit` call at line 120)

**Interfaces:**
- Produces: a definite yes/no on Mechanism A.

- [ ] **Step 1: Attempt the key change**

In `saveEmbedAndExit`, behind a temporary `?spikeConvert=1` guard, attempt to submit an extension-key change alongside the config — e.g. `submit({ extensionKey: '<SEQUENCE_MACRO_KEY value for lite>' , config: {...} })` and any other shape the `@forge/bridge` `view` typings expose.

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "submit"` — expected: the typings tell you immediately whether anything but `config` is accepted. **Read the typings before running the app; this question may be answerable statically in two minutes.**

- [ ] **Step 2: If the typings allow it, deploy and try it live**

Run: `pnpm forge:all:dev`, then on page **T** open the embed macro's editor with the guard on and submit.
Expected: record whether the node's key actually changes in the published ADF.

Verify via the ADF dump (same method as the 2026-07-16 spike Q1):
`GET /wiki/api/v2/pages/<pageId>?body-format=atlas_doc_format` — inspect `extensionKey` on the node.

- [ ] **Step 3: Record and revert**

Record Q1 = YES/NO with the evidence (typing signature or ADF dump). `git checkout src/forge-embed-editor.ts` if NO.

---

### Task 3: Q2 — Mechanism B: fork + repoint + DSL editor

The main event. Only run if Q1 = NO (if Q1 = YES, Mechanism A wins and Gate A = REVERSIBLE — go straight to Task 5).

**Files:**
- Modify: `src/components/DrawIoExtension/ForgeEmbedEditor.vue` (mount the DSL editor instead of `<DocumentList />` when a `?convert=1`-style param is present)
- Modify: `src/forge-embed-editor.ts` (fork-then-submit path)
- Modify: `src/components/Viewer/GenericViewer.vue` (temporary "Make an editable copy" affordance on the blocked Edit, to measure criterion 1)

**Interfaces:**
- Consumes: `ApWrapper2.getCustomContentByIdV2(id)` (`:504`) to read the source, `ApWrapper2.createCustomContentV2(content)` (`:295`) to create the fork.
- Produces: a pasted embed turned into an independently editable diagram — or a specific, named blocker.

- [ ] **Step 1: Fork the content**

From the embed editor, read the source custom content, create a new one from its body under the **current** page as parent, and `view.submit({config: {customContentId: <fork>}})`.

Expected: the macro now renders the forked copy. Check criterion 4 — the source's `latestVersionNumber` must be unchanged.

- [ ] **Step 2: Swap the editor**

Make the embed macro's editor mount the normal DSL editor when its config points at a fork it owns (a marker in the forked body, or config, is fine for a spike — note which, since productization has to pick one).

Expected: the user can change the code and publish; the change renders; the source is still untouched.

- [ ] **Step 3: Check the chrome (criterion 5)**

The viewer decides the `EMBED` chip from `isEmbedded` (`GenericViewer.vue:25`). Record whether the chip is still shown on the converted macro, and whether it can be suppressed without a page ADF change.

- [ ] **Step 4: Count the cost**

Record, against the five criteria: number of user actions from the blocked Edit; whether an extra publish is needed; whether the DSL editor is genuinely reachable; source untouched (version number before/after); chip honest.

- [ ] **Step 5: Commit the spike state**

```bash
git commit -am "spike(embed): fork-and-repoint escape hatch"
```

---

### Task 4: Q3 — is ADF node replacement actually unsupported?

Desk research plus one experiment; run only if Q2 fails.

**Files:** none.

- [ ] **Step 1: Establish what the platform says**

Search the Forge macro / Custom UI docs for any supported way to replace an extension node from within a macro (as opposed to writing the page body wholesale via the REST API). Record the citation or the absence of one — **do not infer support from silence, and do not assert a mechanism you have not seen documented.**

- [ ] **Step 2: Cost the REST alternative**

If the only route is "read the page ADF, swap the node, PUT the page", cost it honestly against the five criteria: it re-publishes the whole page under the app's identity, it races any concurrent human edit, and it puts us in the business of rewriting customer page bodies. Record whether that is acceptable — the recommendation should be NO unless nothing else works.

---

### Task 5: Findings + Gate A

- [ ] **Step 1: Fill the Findings table below** (`.md`-only edits go straight to `main`).

- [ ] **Step 2: Set Gate A in the productization plan**

Edit `2026-07-26-embed-deeplink-productization.md` → the "Gate A result" line and the decisions log.

If **NOT REVERSIBLE**, also apply its stated consequences: paste produces a clone; Task 5 (escape hatch) is deleted with the reason recorded; Task 3 is rewritten to fork on first render.

- [ ] **Step 3: Commit findings; push the branch unmerged for reference**

```bash
git add docs/superpowers/plans/2026-07-26-embed-to-copy-escape-hatch-spike.md \
        docs/superpowers/plans/2026-07-26-embed-deeplink-productization.md
git commit -m "docs(spike): embed-to-copy findings + Gate A"
git push origin main
git push -u origin spike/embed-to-copy-escape-hatch
```

---

## Findings (executed ____, lite-dev, branch @ ____, deployed as ____)

| Question | Answer | Evidence |
|---|---|---|
| Q1 — `view.submit` can change the extension key? | | |
| Q2 — fork + repoint + DSL editor passes all five criteria? | | |
| Q3 — ADF node replacement supported? | | |
| Q4 — `Cmd+Z` reverts an autoconverted paste? | | |
| Criterion 1 — ≤2 actions from blocked Edit | | |
| Criterion 2 — no extra publish | | |
| Criterion 3 — normal DSL editor reachable | | |
| Criterion 4 — source `latestVersionNumber` unchanged | | |
| Criterion 5 — no lying `EMBED` chip | | |

**Execution notes / deviations:**

- _(record anything that made the evidence weaker than it looks — e.g. the known `forge tunnel` Custom-UI resource-serving failure from the 2026-07-16 spike; verify against a deployed dev build instead of a tunnel if it recurs)_

**Gate A:** ☐ REVERSIBLE — paste produces an embed, escape hatch ships ☐ NOT REVERSIBLE — paste produces a clone

## If NOT REVERSIBLE — what changes downstream

Not a cancellation. The productization plan still ships; three things change:

1. Paste produces an **independent copy**, forked from the source at paste time.
2. The embed macro keeps its existing picker entry point and is not promoted — it stays available for users who explicitly want a live reference.
3. Task 10's flip rule inverts: measure how often users go looking for "keep this in sync with the original" **after** taking a copy, and treat that as the signal to invest in embed instead.
