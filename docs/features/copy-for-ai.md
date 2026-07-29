# Copy for AI (demand test)

One-click viewer button that copies a context-framed markdown payload — the diagram's DSL plus the
surrounding Confluence page's text — to the clipboard, for pasting into an AI agent (Claude Code,
ChatGPT, Cursor, …).

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
| Interaction | One click → clipboard + toast. No dialog: every added decision point would measure dialog UX, not demand. |

## Payload

Built by `buildCopyForAiPrompt()` (`src/utils/copyForAi/buildCopyForAiPrompt.ts`): two-line preamble
with a standing edit-back instruction ("if you propose changes, return the complete updated <DSL>
source in a fenced code block"), fenced DSL (fence escalates past embedded backticks), then
`## Page:` title + URL + plain text (URL line omitted if unresolvable). Page text =
`globals.apWrapper.getCurrentPage()` `body.export_view.value` HTML → `htmlToPlainText`
(`src/utils/htmlToPlainText.ts`, shared with Agent Link's `readPage` in
`src/composables/agentLink/forgeBridge.ts`). Page-context failure degrades silently to a
diagram-only payload. Empty DSL is guarded (no copy, no event).

## Analytics

`copy_for_ai_clicked` — `feature_area: 'macro'`, `surface: 'viewer' | 'fullscreen'`, `macro_type`,
`outcome: 'copied' | 'copied_diagram_only' | 'clipboard_failed'`, `dsl_bytes`, `page_bytes`.
One event per click; none on the empty-DSL guard.

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
