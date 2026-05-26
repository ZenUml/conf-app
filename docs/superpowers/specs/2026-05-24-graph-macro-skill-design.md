# Design: `/graph-macro` skill — MCP-driven spot-check playbook for the ZenUML Graph (DrawIO) macro

**Date:** 2026-05-24
**Status:** Design approved through brainstorming; ready for implementation plan
**Owner:** Peng Xiao
**Skill location:** `.claude/skills/graph-macro/SKILL.md`

## 1. Problem statement

When debugging the ZenUML Graph (DrawIO) macro via ad-hoc spot checks, Claude drives Playwright MCP tool-by-tool and re-derives the same load-bearing knowledge from scratch every session:

- The Forge → DrawIO **nested iframe chain** (outer Forge modal → `[data-testid="hosted-resources-iframe"]` → inner DrawIO iframe).
- The **slash-menu keystroke trap** (ProseMirror watches input events; `browser_fill_form` bypasses them and the menu never opens).
- Which **entry point** to use to enter the editor (slash-menu insert vs in-page-editor Edit vs view-mode Edit vs Confluence's native pencil-toolbar fallback for just-copied macros).
- **Where the paywall actually fires** (at editor mount, not at Publish) and how to dismiss it without skewing the `PAYWALL_CONTINUED_EDITING` event count.
- How to **classify the save outcome** (success vs did-not-persist) when the persistence layer silently drops Publish on a paywalled Lite space.

The existing TypeScript helper `tests/e2e-tests/helpers/MacroFlowHelper.ts::insertAndPublishMacro()` covers the scripted-Playwright path but cannot be loaded by MCP. Adjacent skills (`/edit-macro`, `/copy-macro`, `/pvt-drawio`, `/pvt-edit`, `/smoke-test`) each cover a different scope; none owns the Graph-macro in-editor flow for ad-hoc MCP spot checks.

## 2. Goals and non-goals

**Goals**
- Provide a single, MCP-readable playbook that takes Claude from "Confluence page open in Chrome" to "Graph macro inserted or edited, Publish attempted, outcome classified" without re-discovery.
- Work for both **insert** and **edit** entry points (three edit variants total), with auto-fallback from our Edit button to Confluence's native macro-edit pencil for just-copied macros.
- Encode the **paywall behaviour** in code-cited inline caveats so the skill stays correct after the next paywall-scope shift.
- Emit a **structured report** so the caller can interpret success/did-not-persist/paywall-observed without follow-up questions.

**Non-goals**
- Replace `/pvt-drawio` (release-gating PVT — different intent, different success criteria).
- Replace `/smoke-test` (covers macro setup + login + page creation; this skill picks up where `/smoke-test` leaves off).
- Drive any non-Graph macro (use `/edit-macro` or `/smoke-test`).
- Validate the cross-page-copy writeback behaviour (use `/copy-macro`).
- Cover Connect — Connect is gone; pure Forge only.

## 3. Skill identity

| Field | Value |
|---|---|
| **Name** | `graph-macro` |
| **Location** | `.claude/skills/graph-macro/SKILL.md` |
| **Sibling pattern** | Matches `/edit-macro` and `/copy-macro` (noun-only naming) |
| **Trigger phrases** | "insert graph macro", "edit graph macro", "publish graph", "spot check drawio publish", "test graph save" |

**Frontmatter description (draft):**
> Drive the ZenUML Graph (DrawIO) macro through any entry point — slash-menu insert, in-editor Edit, copy-then-edit fallback, or view-mode Edit — and into the inner DrawIO editor to append a timestamp shape and Publish. Classifies the save outcome as success or did-not-persist, and records whether the paywall was observed. Use whenever you need to verify a Graph macro insert/edit/save end-to-end via Playwright MCP without re-deriving the Forge → DrawIO iframe chain. Triggers on "insert graph macro", "edit graph macro", "publish graph", "spot check drawio publish", "test graph save".

## 4. Preconditions

- Chrome already logged in to a Confluence site
- A Confluence page URL is open in the active Chrome tab (view or edit mode is fine)
- Caller knows which variant they're spot-checking (the skill is **variant-agnostic** — it reports observations; the caller interprets)
- Playwright MCP tools (`mcp__playwright__*`) are available

## 5. Entry-point decision tree

The skill picks its entry section from the page's current state, not from a user argument:

```
What's on the page?
├── No Graph macro yet
│   └── Section A: Insert via slash menu
│       (requires page in Edit Mode; if not, click Confluence's page-level Edit button first)
│
└── Graph macro already on page
    ├── Page in View Mode → Section E3: click our viewer's Edit button
    │
    └── Page in Edit Mode → Section E1 with E2 auto-fallback:
        ├── Try E1: click our viewer's Edit button (short timeout ≤ 3s)
        └── If E1 not clickable → E2: click Confluence's native macro pencil/edit toolbar button
            (E2 is the documented fallback for just-copied macros — see /copy-macro)
```

All five entry sections converge on the same postcondition: **"Forge editor modal is open."** Section C runs from there.

## 6. Selector inventory (referenced by all sections)

| Element | Selector | Source |
|---|---|---|
| Forge editor modal | `[data-testid="custom-ui-modal-dialog"]` | verified in `/pvt-edit`, conf-app memory |
| Forge app iframe inside modal | `[data-testid="hosted-resources-iframe"]` | same |
| Inner DrawIO iframe | nested `iframe` reached via Playwright locator chain — **never** `page.frames().find()` (URL-match is fragile across `drawio/editor` vs `drawio/editor.html`) | conf-app memory |
| Macro extension wrap (Edit Mode) | `.extensionView-content-wrap` | `/edit-macro` |
| Confluence native macro pencil/edit toolbar | **TBD — to be pinned during implementation by inspecting the floating selection toolbar that appears when a macro is clicked in the page editor** | discovery during first MCP run |
| Paywall "Continue editing" button | `[data-testid="continue-editing-btn"]` | `src/components/UpgradePrompt/UpgradePrompt.vue:51` |

The `TBD` for E2's pencil-icon selector is acceptable spec-level slack — it will be pinned the first time the skill runs against a page in Edit Mode with our Edit button blocked. The skill records the selector once verified.

## 7. Section A — Insert via slash menu

**Preconditions:** page in Edit Mode (skill clicks Confluence's page-level Edit button first if needed).

**Load-bearing knowledge captured inline in this section:**

1. **Slash-menu keystroke trap.** Use `mcp__playwright__browser_press_key` (or `browser_type` with one-char-at-a-time semantics). **Never** use `browser_fill_form`. Inline comment in skill: *"ProseMirror watches input events; `fill()` bypasses them and the slash menu never opens."*
2. **Pick "Graph (DrawIO)" specifically** from the slash menu (not any other Graph-named option).
3. **Convergence signal:** `[data-testid="custom-ui-modal-dialog"]` appears.

## 8. Section E1 + E2 — Edit in page Edit Mode (auto-fallback)

Documented as a **single section with two steps** so the fallback is intrinsic to the flow, not an indirection.

**Preconditions:** page in Edit Mode, Graph macro already present.

**Step E1 (preferred):**
- Locate our viewer iframe inside `.extensionView-content-wrap` → Forge `[data-testid="hosted-resources-iframe"]` → our viewer
- Find our viewer toolbar's Edit button inside that iframe
- Click with **short timeout (≤ 3 s)** — this is a clickability probe, not a long wait
- If the Forge modal opens → done, proceed to Section C
- If timeout → fall through to E2

**Step E2 (fallback — the just-copied-macro path):**
- Click the macro extension wrap once to select the macro in the page editor
- Confluence shows a floating selection toolbar with a pencil/edit icon (Confluence's native affordance, distinct from our app)
- Click that pencil/edit icon
- Wait for `[data-testid="custom-ui-modal-dialog"]`

**Inline caveat (linking the *why*):** *"Our Edit button is not clickable immediately after Confluence's copy operation — see `/copy-macro` for the underlying writeback race. Always fall through to E2 if E1 doesn't respond within ~3s; do not retry E1."*

The skill records which step actually fired (`entry_path_used = E1` or `E2`) so spot checks investigating copy-related bugs can verify they hit the expected path.

## 9. Section E3 — Edit in View Mode

**Preconditions:** page in View Mode, Graph macro already rendered.

**Steps:**
- Locate our viewer iframe directly (no `.extensionView-content-wrap` envelope in View Mode — the chain is shorter)
- Find Edit button on the viewer toolbar
- Click → wait for `[data-testid="custom-ui-modal-dialog"]`

**Differences from E1 called out inline:** no `.extensionView-content-wrap` envelope; no Confluence-native fallback available (E2 only exists in Edit Mode); our Edit button is generally more reliably clickable here since there's no editor-mount race.

## 10. Section C — Shared in-editor tail

All entry sections converge here once `[data-testid="custom-ui-modal-dialog"]` is open.

### 10.1 Step C0 — Paywall check (immediately after editor opens)

**Trigger condition:** Forge editor modal opened.

1. Inside the Forge iframe, check for `[data-testid="continue-editing-btn"]` (short timeout ~2 s — the overlay mounts synchronously with the editor).
2. **If present:**
   - Record `paywall_observed = yes`.
   - Capture the most recent `paywall_triggered` Mixpanel intercept from `api.mixpanel.com` to record `action_type` (`page_editor` for edit-blocked, `page_editor_create` for create-blocked). The skill only drives the editor surface; `fullscreen_viewer` is never expected here — if observed, flag it as an anomaly.
   - Click `[data-testid="continue-editing-btn"]` → emits `PAYWALL_CONTINUED_EDITING`.
   - Wait for the overlay to disappear.
3. **If absent:** `paywall_observed = no`. Proceed.

**Inline caveat (code-cited):**
> Paywall mounts at editor entry, not at Publish. See `src/utils/paywall/mountPaywallGate.ts:121-165` — `tryPageEditorPaywall()` is called during the editor's mount path, and `src/components/UpgradePrompt/PaywallGate.vue:7-17` documents that the editor mounts *underneath* the overlay. After dismissing 'Continue editing', the editor is interactive but the save is silently dropped by `shouldBlockActions` in the persistence layer. The Publish click looks normal; the modal just doesn't close. Dismiss **only** via `[data-testid="continue-editing-btn"]` — backdrop click fires `MODAL_DISMISSED` instead of `PAYWALL_CONTINUED_EDITING`, which would skew the continued-editing rate.

### 10.2 Step C1 — Drill outer → inner DrawIO iframe

1. From `[data-testid="custom-ui-modal-dialog"]`, locate Forge app iframe: `[data-testid="hosted-resources-iframe"]`
2. Inside that iframe, locate the nested inner DrawIO iframe via Playwright locator chain — **not** `page.frames().find()`.

### 10.3 Step C2 — Append timestamp text shape (without overwriting)

**Design goal:** the published result is observable (you can see WHEN the spot check ran) AND non-destructive (existing canvas content untouched).

**Timestamp content:** `edit-test YYYY-MM-DD HH:mm UTC` (e.g. `edit-test 2026-05-24 10:23 UTC`). The `edit-test` prefix is a recognisable marker; the UTC timestamp is sortable and unambiguous.

**Mechanism — primary path:**
1. Double-click an empty area near the top-left of the canvas (default offset `(20, 20)`).
2. DrawIO's shape picker opens → type `text` → press Enter → a text shape is placed.
3. Type the timestamp content → press `Escape` to commit.

**Mechanism — fallback path (if primary is flaky against the deployed DrawIO build):**
Use `mcp__playwright__browser_evaluate` inside the inner DrawIO iframe to call mxGraph's `editorUi.editor.graph.insertVertex(...)` directly with the timestamp string. More invasive but bypasses UI-version drift in DrawIO's shape picker.

**Inline caveat:** *"Pick an offset that's unlikely to overlap existing content (top-left margin works for most diagrams). Never click on or near existing shapes — that may modify them."*

### 10.4 Step C3 — Click Publish in the inner DrawIO frame

**Critical trap (from `tests/e2e-tests/helpers/MacroFlowHelper.ts` and conf-app memory):** Publish lives in the **inner** DrawIO frame, not the outer Forge modal. Both Connect and Forge are the same here.

Inline reminder: *"Do not look for Publish in the Forge modal chrome — the modal does not own that button. Click Publish inside the inner DrawIO iframe you drilled to in C1."*

### 10.5 Step C4 — Watch for save completion (single watcher)

Wait up to **15 s** for the Forge editor modal `[data-testid="custom-ui-modal-dialog"]` to disappear AND the underlying viewer iframe to re-render with the new timestamp.

| Result | Classification |
|---|---|
| Modal closes + viewer updates within 15 s | `outcome = success` |
| Timeout | `outcome = did-not-persist` |

If `outcome = did-not-persist` and `paywall_observed = no`, capture `mcp__playwright__browser_console_messages` for the report.

### 10.6 Step C5 — Structured report

Skill always emits:

```
Outcome:                <success | did-not-persist>
Entry path used:        <A | E1 | E2 | E3>
Timestamp injected:     edit-test 2026-05-24 10:23 UTC
Time to outcome:        <Ns>
Paywall observed:       <yes | no>
  action_type:          <page_editor | page_editor_create>   (only if yes; fullscreen_viewer = anomaly)
Console errors (only if did-not-persist AND paywall_observed=no): [<…>]
```

## 11. Caller-side interpretation hints

Documented as a small reference table at the end of the skill so the caller doesn't need follow-up questions:

| Variant | Expected pattern |
|---|---|
| Lite (paywalled space) | `paywall_observed = yes` + `outcome = did-not-persist` — expected |
| Lite (non-paywalled space) | `paywall_observed = no` + `outcome = success` — expected |
| Full / Diagramly | `paywall_observed = no` + `outcome = success` — expected |
| **Suspect** | `paywall_observed = yes` + `outcome = success` (save went through despite paywall), or `paywall_observed = no` + `outcome = did-not-persist` (real failure) |

## 12. Cross-references included at the top of the skill

- For non-Graph macro edits (no DrawIO inner iframe drill): `/edit-macro`
- For testing the cross-page-copy writeback specifically: `/copy-macro`
- For release-gating validation (not ad-hoc spot checks): `/pvt-drawio` and `/pvt-edit`
- For full smoke flow including login + page creation: `/smoke-test` (this skill picks up after page is open)

## 13. Implementation notes

- Skill file: single `SKILL.md` at `.claude/skills/graph-macro/SKILL.md`. No supporting scripts, no shell helpers — pure markdown playbook readable by MCP-driven Claude.
- The `TBD` selector for Confluence's native macro pencil/edit toolbar (Section 6) is resolved during the first MCP run; the skill is updated in-place once pinned.
- Memory entries to update after the skill is committed: `project_paywall_production_scope.md` (current memory says "only rendered-viewer Edit button is gated"; the user confirmed in this brainstorm that **all save paths are gated** on Lite). This is a separate memory edit, not part of the skill.

## 14. Acceptance criteria

1. Skill file exists at `.claude/skills/graph-macro/SKILL.md` with the description, preconditions, decision tree, all five entry sections (A, E1+E2, E3) converging on Section C (C0–C5), selector inventory, caller-side interpretation table, and cross-references as specified above.
2. Each load-bearing trap (slash-menu keystrokes, inner-frame Publish, paywall placement, dismiss-button-only) is captured as an inline caveat with a code citation where applicable.
3. The skill triggers reliably on "insert graph macro", "edit graph macro", "publish graph", "spot check drawio publish", "test graph save".
4. A first MCP-driven run against `zenuml-stg.atlassian.net` or `lite-stg.atlassian.net` (caller's choice) produces a complete structured report and pins the `TBD` selector for E2.

## 15. Out of scope (deferred)

- The "copy-page" sibling skill the user mentioned in the original brainstorm — agreed in Question 1 to keep this brainstorm to a single skill.
- TypeScript helper extension (`assertSaveCompleted` etc.) — only the MCP playbook is in scope per Question 2.
- Variant-aware argument parsing (`/graph-macro lite|full|diagramly`) — Question 5 chose variant-agnostic.
- Automatic environment selection (e.g. detect which Confluence site is open and choose expectations) — caller interprets.
