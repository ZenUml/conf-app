---
name: graph-macro
description: Drive the ZenUML Graph (DrawIO) macro through any entry point — slash-menu insert, in-editor Edit, copy-then-edit fallback, or view-mode Edit — and into the inner DrawIO editor to append a timestamp shape and Publish. Classifies the save outcome as success or did-not-persist, and records whether the paywall was observed. Use whenever you need to verify a Graph macro insert / edit / save end-to-end via agent-browser without re-deriving the Forge → DrawIO iframe chain. Triggers on "insert graph macro", "edit graph macro", "publish graph", "spot check drawio publish", "test graph save", "verify graph publish on lite", or any ad-hoc Graph-macro spot check on lite-stg / full-stg / dia-stg / zenuml-stg / prod.
---

# Graph (DrawIO) macro — spot-check playbook

A single playbook that takes you from "Confluence page open in Chrome" to "Graph macro inserted or edited, Publish attempted, outcome classified." Avoids re-deriving the Forge → DrawIO iframe chain, the slash-menu keystroke trap, the paywall placement, and the metered continue-attempts semantics — each is captured inline below with a code citation so you can trust the why, not just the what.

## When to use this skill vs an adjacent one

| If you need to … | Use |
|---|---|
| Spot-check the Graph macro insert / edit / publish flow | **this skill** |
| Edit a non-Graph macro (no DrawIO inner iframe) | `/edit-macro` |
| Verify the cross-page-copy writeback behaviour specifically | `/copy-macro` |
| Run release-gating validation (not ad-hoc) | `/pvt-drawio` or `/pvt-edit` |
| Set up a fresh page from scratch (login + page creation) | `/smoke-test`, then come back to this skill |

This skill is **variant-agnostic**. It reports observations; the caller (you) interprets the result against the variant under test using the table in the final section.

## Preconditions

- Chrome already logged in to a Confluence site.
- A Confluence page URL is open in the active Chrome tab (view or edit mode is fine — the skill clicks Confluence's page-level Edit button itself if Insert is needed and the page is in view mode).
- `agent-browser` on PATH. Every call takes `--session conf-app --restore=stg` (see `CLAUDE.md` § "Browser automation and Forge iframes").

You do **not** need to specify a variant. Drive whichever site is open; interpret the report at the end.

## Selector inventory (referenced throughout)

| Element | Selector |
|---|---|
| Forge editor modal | `[data-testid="custom-ui-modal-dialog"]` |
| Forge app iframe inside the modal | `[data-testid="hosted-resources-iframe"]` |
| Inner DrawIO iframe | nested `iframe`; reach it with a second `agent-browser frame "@<ref>"` after re-reading the ref from a snapshot taken *inside* the modal iframe. Never match by URL — it is fragile across `drawio/editor` vs `drawio/editor.html`. Most tasks do not need to enter it at all; use the postMessage protocol from the modal iframe instead (Section C2 fallback). |
| Macro extension wrap (in Edit Mode) | `.extensionView-content-wrap` |
| Confluence native macro pencil / edit toolbar (Edit Mode fallback) | **TBD** — pin on first run by inspecting the floating selection toolbar that appears after clicking a macro in the page editor, then update this table |
| Paywall "Continue editing" button | `[data-testid="continue-editing-btn"]` (defined in `src/components/UpgradePrompt/UpgradePrompt.vue:51`) |

The `TBD` is acceptable slack — pin it the first time this skill drives a page with our Edit button blocked, and record the verified selector here in-place.

## Entry-point decision tree

Pick the entry section by looking at the page's current state. Do not ask the caller; observe.

```
What's on the page?
├── No Graph macro yet
│   └── Section A: Insert via slash menu
│       (requires page in Edit Mode; if currently in View Mode,
│        click Confluence's page-level Edit button first and wait
│        for the editor toolbar)
│
└── Graph macro already on page
    ├── Page in View Mode → Section E3: click our viewer's Edit button
    │
    └── Page in Edit Mode → Section E1 with E2 auto-fallback:
        ├── Try E1: click our viewer's Edit button (short timeout ≤ 3 s)
        └── If E1 not clickable → E2: click Confluence's native macro
            pencil / edit toolbar button
            (E2 is the documented fallback for just-copied macros —
             see /copy-macro)
```

All entry sections converge on the same postcondition: **the Forge editor modal `[data-testid="custom-ui-modal-dialog"]` is open**. Section C runs from there.

Record `entry_path_used` in the final report (`A`, `E1`, `E2`, or `E3`) so spot checks investigating copy-related bugs can verify they hit the expected path.

---

## Section A — Insert via slash menu

**Preconditions:** page in Edit Mode. If currently in View Mode, click Confluence's page-level Edit button and wait until the editor toolbar mounts before continuing.

**Steps:**

1. Click in the page body to position the cursor.
2. Type `/` then `graph` using `agent-browser keyboard type` (real keystrokes), or `press` one key at a time.

   > **Keystroke trap:** ProseMirror (Confluence's editor) watches `input` events. `agent-browser fill` sets the value directly and bypasses them, so the slash menu never opens. Use `keyboard type`, which emits real keystrokes.

3. Wait for the slash menu to render the Graph option, then click **"Graph (DrawIO)"** specifically. Do not pick any other Graph-named option.
4. Wait for `[data-testid="custom-ui-modal-dialog"]` to appear.

**Convergence:** Forge modal is open. Proceed to Section C.

---

## Section E1 + E2 — Edit in page Edit Mode (auto-fallback)

Documented as one section with two steps so the fallback is intrinsic, not an indirection.

**Preconditions:** page in Edit Mode, Graph macro already present on the page.

### Step E1 (preferred)

1. Drill to our viewer iframe: `.extensionView-content-wrap` → `[data-testid="hosted-resources-iframe"]` → our viewer.
2. Inside that iframe, locate our viewer toolbar's **Edit** button.
3. Click with a **short timeout (≤ 3 s)** — this is a clickability probe, not a long wait.
4. If `[data-testid="custom-ui-modal-dialog"]` appears → record `entry_path_used = E1`, proceed to Section C.
5. If the click times out or has no effect → fall through to E2. Do not retry E1.

### Step E2 (fallback — just-copied-macro path)

1. Click the `.extensionView-content-wrap` once to select the macro in the page editor.
2. Confluence renders a floating selection toolbar with a pencil / edit icon — its own native affordance, distinct from our app.
3. Click that pencil / edit icon (selector TBD on first run — update the selector inventory once pinned).
4. Wait for `[data-testid="custom-ui-modal-dialog"]`. Record `entry_path_used = E2`.

> **Why the fallback exists:** Our Edit button is not clickable immediately after Confluence's copy operation — see `/copy-macro` for the underlying writeback race. Always fall through to E2 if E1 doesn't respond within ~3 s; do not retry E1 with longer timeouts.

**Convergence:** Forge modal is open. Proceed to Section C.

---

## Section E3 — Edit in View Mode

**Preconditions:** page in View Mode (do **not** click Confluence's page Edit button), Graph macro already rendered.

**Steps:**

1. Locate our viewer iframe directly. In View Mode there is no `.extensionView-content-wrap` envelope — the chain is shorter than in Edit Mode.
2. Find the **Edit** button on the viewer toolbar.
3. Click it; wait for `[data-testid="custom-ui-modal-dialog"]`. Record `entry_path_used = E3`.

E2 is not available in View Mode — Confluence's native macro toolbar only appears inside the page editor. Our Edit button is generally more reliably clickable here than in E1 because there is no editor-mount race.

**Convergence:** Forge modal is open. Proceed to Section C.

---

## Section C — Shared in-editor tail

Runs after **any** of A / E1 / E2 / E3 leaves `[data-testid="custom-ui-modal-dialog"]` open. Six steps: C0 paywall check, C1 drill, C2 timestamp, C3 publish, C4 outcome watcher, C5 report.

### C0 — Paywall check (immediately after editor opens)

The paywall fires at editor **entry**, not at Publish. Handle it before drilling.

> **Retired 2026-09:** the Lite paywall block described below no longer fires (`shouldBlockActions`
> is hardcoded `false` — see the `paywall` skill's retirement notice). Step 3 ("If absent") is now
> the only reachable outcome; keep this step for regression coverage, but do not spend time chasing
> `paywall_triggered` if it is missing — it no longer emits.

1. Inside the Forge iframe, check for `[data-testid="continue-editing-btn"]` with a short timeout (~2 s — the overlay mounts synchronously with the editor).
2. **If present** (`paywall_observed = yes`):
   - Capture the most recent `paywall_triggered` event from `api.mixpanel.com` to record `action_type` (`page_editor` for edit-blocked, `page_editor_create` for create-blocked). The skill only drives the editor surface, so `fullscreen_viewer` should never appear here — if it does, flag it as an anomaly in the report.
   - Click `[data-testid="continue-editing-btn"]` (this emits `PAYWALL_CONTINUED_EDITING` per `src/components/UpgradePrompt/UpgradePrompt.vue:110`).
   - Wait for `[data-testid="continue-editing-btn"]` to disappear.
3. **If absent:** record `paywall_observed = no` and proceed.

> **Why paywall belongs here, not at Publish:** `src/utils/paywall/mountPaywallGate.ts` (`tryPageEditorPaywall`) runs synchronously during the editor's mount path — the gate is the **modal at editor entry**, never a save-time check. The Lite paywall is a **metered soft-paywall**: each "Continue editing without upgrading (N)" click decrements a localStorage counter (`DEFAULT_CONTINUE_ATTEMPTS = 3` since 2026-08-16, was 15; key `paywallContinueAttempts:<domain>:<space>:<user>`), and during that grace window **saves succeed by design** — `saveToPlatform` deliberately has no `shouldBlockActions` check. At N=0 the Continue button is replaced by the non-clickable "Request extension to continue editing" span (`[data-testid="continue-attempts-exhausted"]`), so the user never reaches the editor at all: blocking happens at the modal, not at Publish. If C0 finds that exhausted state instead of `continue-editing-btn`, record it and stop the run there — that is the intended lockout. (Some code comments still describe a persistence-layer save gate; that wording is misleading — ignore it. Canonical model: CLAUDE.md § "How the Lite paywall actually enforces".)

> **Dismiss only via the button, not the backdrop.** Backdrop click fires `MODAL_DISMISSED` instead of `PAYWALL_CONTINUED_EDITING`, which would skew the continued-editing rate the team tracks.

### C1 — Drill outer → inner DrawIO iframe

1. From `[data-testid="custom-ui-modal-dialog"]`, locate `[data-testid="hosted-resources-iframe"]` (Forge app iframe).
2. Inside that iframe, locate the nested inner DrawIO iframe **via Playwright locator chain**.

> Both `drawio/editor` and `drawio/editor.html` appear in different builds. `page.frames().find()` URL-matching can pick the wrong frame. Use the locator chain instead.

### C2 — Append a timestamp text shape (without overwriting)

The goal of this step is to make the published result observable (you can see *when* the spot check ran) and non-destructive (existing canvas content untouched).

**Timestamp content:** `edit-test YYYY-MM-DD HH:mm UTC` — for example `edit-test 2026-05-24 10:23 UTC`. The `edit-test` prefix is a recognisable marker for grep / future debugging; UTC keeps it sortable and unambiguous.

**Primary mechanism (UI-driven):**

1. Double-click an empty area near the canvas top-left (offset `(20, 20)` is safe for most diagrams).
2. DrawIO's shape picker opens → type `text` → press **Enter** to place a text shape.
3. Type the timestamp content.
4. Press **Escape** to commit.

**Fallback mechanism (API-driven, use if primary is flaky against the deployed DrawIO build):**

Talk to DrawIO over its **postMessage protocol** from the *outer* Forge iframe — one `frame` hop, no need to enter the DrawIO frame itself:

```bash
A(){ agent-browser --session conf-app --restore=stg "$@"; }
A frame "@<editor-oopif-ref>"     # the 1200x849 modal iframe, NOT the inner DrawIO one

# Replace the whole diagram
A eval "document.querySelector('iframe').contentWindow.postMessage(JSON.stringify({action:'load', xml:'<mxGraphModel>…</mxGraphModel>', autosave:1}), '*'); 'sent'"

# Read the current diagram back (DrawIO replies with an 'export' event)
A eval "window.__cap=[]; addEventListener('message', e=>{try{const p=JSON.parse(e.data); if(p.event) window.__cap.push(p);}catch(x){}}); 'armed'"
A eval "document.querySelector('iframe').contentWindow.postMessage(JSON.stringify({action:'export', format:'xmlsvg'}), '*'); 'sent'"
A eval "JSON.stringify(window.__cap.map(p=>({event:p.event, len:(p.xml||'').length})))"
```

> **`editorUi.editor.graph.insertVertex(...)` has no entry point — do not try it.** The editor loads with `embed=1` (`ForgeGraphEditor.vue:9`), DrawIO's official embed mode, which deliberately keeps its UI object inside a closure and exposes *only* the postMessage JSON protocol. `window.editorUi` does not exist, and nothing on `window` holds `.editor.graph` — verified 2026-08-17 by scanning every own-property of `window`, the `.geEditor` container node, and `mxEvent.objects`. This is the integration's design, not version drift.
>
> The app itself uses this protocol (`ForgeGraphEditor.vue:82` `sendToFrame`), so the actions are exactly the ones it already handles: `load` (with `autosave:1`) and `export`. Incoming events are `init`, `autosave`, `save`, `export`.

> **Don't click on or near existing shapes** — that may select / modify them. The top-left margin works as a default; if the diagram has content there, pick another empty spot but never overlap existing geometry.

### C3 — Click Publish in the inner DrawIO frame

> **The trap that costs everyone time:** Publish lives in the **inner** DrawIO frame, not the outer Forge modal. The Forge modal chrome does not own that button. This is the same for Connect and Forge; do not search the outer modal for Publish. Verified in `tests/e2e-tests/helpers/MacroFlowHelper.ts` (`clickEditorPublish(page, { nested: 'drawio' })`).

Click Publish inside the inner DrawIO iframe drilled in C1.

### C4 — Watch for save completion (single watcher)

Wait up to **15 s** for two things together:

1. `[data-testid="custom-ui-modal-dialog"]` disappears, AND
2. Our viewer iframe re-renders with the new timestamp shape visible.

| Result | Classification |
|---|---|
| Both happen within 15 s | `outcome = success` |
| Timeout | `outcome = did-not-persist` |

There is **no second paywall watcher** at this step — the paywall has already been observed (or not) in C0, and it never gates the save itself. Once "Continue editing" was clicked in C0, the metered grace window applies and **the save is expected to persist — even on a paywalled Lite space**.

`outcome = did-not-persist` is therefore **always a real failure to investigate**, regardless of `paywall_observed`. Capture `agent-browser --session conf-app --restore=stg console` for the report (it includes the macro OOPIF's own logs).

### C5 — Structured report

Emit this exact shape so the caller can interpret without follow-up questions:

```
Outcome:                <success | did-not-persist>
Entry path used:        <A | E1 | E2 | E3>
Timestamp injected:     edit-test YYYY-MM-DD HH:mm UTC
Time to outcome:        <Ns>
Paywall observed:       <yes | no>
  action_type:          <page_editor | page_editor_create>   (only if yes; fullscreen_viewer here = anomaly)
Console errors (whenever outcome = did-not-persist — a non-persisting save is always a real failure):
  [<error 1>, <error 2>, …]
```

---

## Caller-side interpretation hints

| Variant under test | Expected pattern |
|---|---|
| Lite (paywalled space, Continue clicked in C0) | `paywall_observed = yes` + `outcome = success` — saves persist during the metered grace window **by design**; this is NOT a broken gate |
| Lite (paywalled space, continue attempts exhausted, N=0) | Run stops at C0: the modal shows the non-clickable "Request extension to continue editing" (`continue-attempts-exhausted`) and the editor is unreachable. Blocking happens at the modal, never at save time. |
| Lite (non-paywalled space) | `paywall_observed = no` + `outcome = success` |
| Full / Diagramly | `paywall_observed = no` + `outcome = success` |
| **Suspect — investigate** | `outcome = did-not-persist` in ANY combination — a save that doesn't persist is never the expected paywall behaviour; read the console errors. Also investigate `paywall_observed = yes` on Full/Diagramly (paywall is Lite-only). |

If `action_type = fullscreen_viewer` shows up in the report, that's also an anomaly — this skill only ever drives the editor surface, so the fullscreen-viewer paywall path should never be hit here.
