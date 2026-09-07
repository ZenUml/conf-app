# Copy for AI (demand test)

Viewer split button that copies a context-framed markdown payload — the diagram's DSL plus the
surrounding Confluence page's text — to the clipboard, for pasting into an AI agent (Claude Code,
ChatGPT, Cursor, …). The primary segment is one click with a generic prompt; the chevron segment
opens a menu of five job-framed entry points that copy the exact same payload, differing only in
the preamble that frames what the paste is for.

**Status: test concluded 2026-08-30 — passed, narrowly. The button stays.** See
[Outcome](#outcome-2026-08-30) below before reading the decision rule, which is preserved as
written rather than rewritten after the fact.

This feature existed to measure whether "diagram + page content → AI agent" is a real user job
*before* further Agent Link stabilization investment. It is deliberately not an Agent Link surface:
no live session, no dialog, no deep links, nothing leaves the browser except via the user's own
clipboard.

## Outcome (2026-08-30)

The 30-day window ran 2026-07-30 to 2026-08-30, non-internal, 188 unique copiers across 86 tenants
and 285 clicks.

| Reading | Result | Rule |
|---|---|---|
| **Primary — try rate** | **2.15%** | ≥2% → pass. Passed on the last read, having climbed 1.28 → 1.63 → 1.78 → 2.15. |
| **Override — repeat cohort** | 5.85% (11 of 188) | Intended to *rescue* a marginal miss. Here it points the other way. |

Per the rule as written, the primary passed: **demand confirmed, Agent Link investment continues,
the button is not reverted.**

It passed on the weaker of the two readings, and that matters more than the pass. Against the
control — `viewer_source_copied`, the plain copy button on the same toolbar, same population, same
window — Copy for AI loses on every measure of habit:

| | Copy for AI | `viewer_source_copied` |
|---|---:|---:|
| Users returning on a second day | 5.85% | 23.5% |
| Used exactly once | 75% | 45.8% |
| Median clicks per user | 1 | 2 |
| Copy → save within 2h | 21.4% | 26.9% |

The verdict recorded at the time: **reach grows, habit does not.** The feature roughly doubled the
copying population — 59 people used Copy for AI and never touched the plain copy button, with no
cannibalization of it — but the people it reached did not come back, and they completed a write-back
less often than the plain button's users did.

**What this bounds for Agent Link.** Copy for AI is a *direct* proxy for Agent Link's funnel top,
not a partial one: same viewer toolbar, same population, same job of "update the diagram I am
looking at". Every number here is therefore an **upper bound** on Agent Link, which costs a click
*plus* a token paste *plus* one-time MCP setup. Try rate ≤2.15%; return-on-another-day ≤5.85%; the
manual copy → AI → save loop runs about 40 users a month fleet-wide. A production cohort enable of
`agent-link-enabled` measures what fraction of those hand-loopers complete MCP setup — a
setup-friction test, not a second demand test.

**Discovery rate, computed 2026-09-07.** `copy_for_ai_impression` was added on 2026-08-11 to supply
a denominator of people who actually *saw* the button, rather than all text-DSL viewers. That number
was never computed before the decision was taken, and the 2.15% above rests on the older, wider
denominator. Measured over the 30 days to 2026-09-07, non-internal: 4,414 users saw the button and
166 clicked it — a **3.76% discovery rate**, i.e. the feature looks better on the denominator built
for it than on the one the verdict used. It does not change the habit findings, which are the
binding ones.

That event is sampled to 10% from 2026-09-07 (`utils/analytics/eventSampling.ts`): at 80,912
occurrences a month it was 19.4% of all billable Mixpanel volume, and the rate it feeds survives
sampling. Treat 3.76% as the pre-sampling reference.

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

`copy_for_ai_impression` fires once per eligible viewer instance; `copy_for_ai_menu_opened` fires on
every closed→open transition. Together they provide the discovery denominator before the click.

`copy_for_ai_clicked` — `feature_area: 'macro'`, `surface: 'viewer' | 'fullscreen'`, `macro_type`,
`outcome: 'copied' | 'copied_diagram_only' | 'clipboard_failed'`, `dsl_bytes`, `page_bytes`,
`job: 'generic' | 'explain' | 'update' | 'implement' | 'audit' | 'tests'` (which entry point fired
the click — split-button primary vs. one of the five menu items), plus `copy_source`, `copy_job`, and
on success `copy_id`. One event per click, primary or menu item; none on the empty-DSL guard.

After a successful Copy for AI or View Source copy, the viewer writes a metadata-only marker to
same-tab `sessionStorage`, partitioned by `custom_content_id` and expiring after 60 minutes. An
accepted editor-wide replacement reads that marker at transaction time and carries the matching
`copy_id`; this is a temporal same-tab attribution signal, not proof that AI produced or that the
user adopted the content. No diagram/page text or content hash is stored in the marker or sent in
replacement telemetry.

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
