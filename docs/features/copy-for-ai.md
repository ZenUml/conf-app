# Copy for AI (demand test)

Viewer split button that copies a context-framed markdown payload — the diagram's DSL plus the
surrounding Confluence page's text — to the clipboard, for pasting into an AI agent (Claude Code,
ChatGPT, Cursor, …). The primary segment is one click with a generic prompt; the chevron segment
opens a menu of five job-framed entry points that copy the exact same payload, differing only in
the preamble that frames what the paste is for.

**Status:** demand test. This feature exists to measure whether "diagram + page content → AI agent"
is a real user job *before* further Agent Link stabilization investment. It is deliberately not an
Agent Link surface: no live session, no dialog, no deep links, nothing leaves the browser except via
the user's own clipboard.

## Scope (settled 2026-07-29)

| Dimension | Decision |
|---|---|
| Macro types | Sequence / Mermaid / PlantUML — same gate as View Source (#333). Graph/OpenAPI/Embed excluded in v1 (OpenAPI is the first v2 candidate). |
| Audience | All viewers (no edit permission), inline + fullscreen viewer. Not in the editor. |
| Variants | lite + full + diagramly (wherever text-DSL macros ship). |
| Flag | None — Lite is at its 10/10 flag cap; worst failure is a dead button; removal is a revert PR. |
| Interaction | Split button (`src/components/Viewer/GenericViewer.vue` + `CopyForAiMenu.vue`): primary segment = one click → clipboard write, generic prompt. Feedback is inline on the primary segment itself (Mintlify-style — added 2026-07-30): idle "Copy for AI" → "Copying…" (disabled, `aria-busy`) → "Copied" or "Copy failed"/"Nothing to copy", then reverts to idle after ~2s; no toast. Chevron segment = menu of five job-framed entries; picking one closes the menu and plays the same state machine on the primary segment. No dialog: every added decision point would measure dialog UX, not demand. |

## Jobs (split-button menu, added 2026-07-30)

Every job copies the identical DSL + page-context payload (`## Diagram` / `## Page`, fence
escalation, byte counts, URL-omission, diagram-only fallback) — only the preamble paragraph differs.
`job: 'generic'` is the primary segment (unchanged since launch); the other five are the chevron
menu's entries, `job` value in parentheses:

| Menu label | Description line | `job` |
|---|---|---|
| Ask about this flow | Get answers from the diagram and its page | `explain` |
| Update this diagram | Describe a change, get paste-ready source back | `update` |
| Implement this design | Take the spec into your coding agent | `implement` |
| Check against my codebase | Find where diagram and code disagree | `audit` |
| Generate test cases | Derive tests from this flow | `tests` |

Per-job preamble wording lives in `jobBody()` / `jobIntroExtra()`
(`src/utils/copyForAi/buildCopyForAiPrompt.ts`) — `implement` and `audit` additionally append a
sentence to the intro line framing the page as a spec/doc to work from ("They specify a design to
implement." / "They document how this system is supposed to work.").

## Payload

Built by `buildCopyForAiPrompt()` (`src/utils/copyForAi/buildCopyForAiPrompt.ts`): a job-selected
preamble (see Jobs above; `generic`'s wording is the original launch text, byte-identical) with a
standing edit-back instruction ("if you propose changes, return the complete updated <DSL> source in
a fenced code block"), fenced DSL (fence escalates past embedded backticks), then `## Page:` title +
URL + plain text (URL line omitted if unresolvable). Page text =
`globals.apWrapper.getCurrentPage()` `body.export_view.value` HTML → `htmlToPlainText`
(`src/utils/htmlToPlainText.ts`, shared with Agent Link's `readPage` in
`src/composables/agentLink/forgeBridge.ts`). Page-context failure degrades silently to a
diagram-only payload, for every job. Empty DSL is guarded (no copy, no event) regardless of entry
point.

## Analytics

`copy_for_ai_clicked` — `feature_area: 'macro'`, `surface: 'viewer' | 'fullscreen'`, `macro_type`,
`outcome: 'copied' | 'copied_diagram_only' | 'clipboard_failed'`, `dsl_bytes`, `page_bytes`,
`job: 'generic' | 'explain' | 'update' | 'implement' | 'audit' | 'tests'` (which entry point fired
the click — split-button primary vs. one of the five menu items). One event per click, primary or
menu item; none on the empty-DSL guard.

## Decision rule

Window: 30 days from prod release · non-internal (`is_internal_client_domain = false`) · lite+full+diagramly.

1. **Primary:** unique users firing `copy_for_ai_clicked` ÷ unique users firing `macro_viewed` on
   text-DSL types ≥ **2%** → demand confirmed, continue Agent Link investment.
2. **Override:** a meaningful repeat cohort (≥2 copies on distinct days) outweighs a marginal miss
   of the 2% line — repeat use means the paste delivered value.
3. **Day-14 read is instrumentation QA only** (events flowing, outcome distribution sane, no
   `clipboard_failed` spike), not an early verdict.
4. Watch `viewer_source_copied` for a cannibalization dip — pre-launch it ran ~1%/mo of text-DSL
   viewers (98 uniques in its first ~17 days).

Baselines captured 2026-07-29 (Mixpanel 3373228, 30d, non-internal): 11,438 unique `macro_viewed`
users; **9,337** on text-DSL types (the denominator); View Source opened by 298 uniques in its first
~17 days (~3.2% — proves the row gets discovered well above the 2% bar); `fullscreen_opened` 1,552
(13.6%, ceiling for an always-visible button).

Fail → revert PR removes the button; the payload/analytics groundwork stays reusable for Agent Link.

## Query snippets

Unique copiers vs denominator (insights, bar = deduplicated across range):
- Metric A: `copy_for_ai_clicked`, unique. Metric B: `macro_viewed`, unique, breakdown `macro_type`
  custom group {sequence, mermaid, plantuml}. Filter `is_internal_client_domain = false`.
- Repeat cohort: `copy_for_ai_clicked` with measurement frequency-per-user (histogram), same filter,
  30d — read the ≥2 bucket; distinct-day repeat needs a JQL pass (`scripts/mp_query.py`).
- Job breakdown: `copy_for_ai_clicked`, unique (or total, for raw click volume), breakdown by `job`.
  Filter `is_internal_client_domain = false`. Events emitted before 2026-07-30 predate the `job`
  property and fall into an implicit "(not set)" bucket — treat those as `generic` (the only entry
  point that existed then), not as missing data.

## Job-composition readout

Once the split button has real volume, read the job breakdown alongside the repeat cohort (Decision
rule, override clause): a repeat cohort skewed toward `explain`/`audit` (read-only jobs — the user
pastes, reads the answer, and the interaction ends) argues for investing further Agent Link effort in
richer **read/discovery** surfaces before write-back. A repeat cohort skewed toward
`update`/`implement`/`tests` (jobs whose whole point is getting DSL back and pasting it in) argues the
opposite — that users already want the **write-back** loop Agent Link exists to close, and the
manual copy/paste round-trip this demand test measures is itself the friction to remove next.
`generic` clicks don't resolve this split (no declared intent) and should be read only for
raw-volume/baseline comparison, not folded into either bucket.
