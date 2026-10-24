# Job B Editor Staleness Hint — Design

Item ③ of the 2026-07-18 dormant-activation program. Approved in-session 2026-07-18 ("开干").

## Goal

**Freshness as the shell, conversion as the core.** The hint's stated job is Job B — keep the
diagram true after the page changed under it. The measured goal is champion succession:
**non-author editors making their first diagram edit.** North-star metric: users whose first-ever
`macro_save_succeeded` is attributable to a hint click (join `staleness_hint_clicked` →
`macro_save_succeeded` per accountId).

Market size (measured 2026-07): 17,006 edits of diagram-bearing pages / 1,644 distinct editors /
359 tenants per 28 days (D1 `AnalyticsEventFact.contentId = CustomContent.pageId`,
`event='page_updated'`).

## The affordance

A thin hint strip rendered **inside the macro's own iframe**, on **editor surfaces only** —
granularity matching: a diagram-level message lives on the diagram. No Forge guidance API exists
(no spotlight/tour for apps) and none is needed; this is the same in-macro affordance class as
View Source (#333, 45% engagement precedent). The macro's floating toolbar is Atlassian's and
cannot be extended.

- **Placement:** top edge of the diagram render, over content, never a modal.
- **Copy** (professional register — facts and permissions, no persuasion):
  - Non-author of this diagram: 「页面在这张图上次更新后已改动 **N** 次，图表内容可能已滞后。拥有页面编辑权限的成员均可直接更新。」
  - Diagram author: 「页面在这张图上次更新后已改动 **N** 次，图表可能需要同步更新。」
  - Variant selection compares the current `accountId` against the diagram's last-version author
    (custom content version data — direct runtime data, not a ② cohort; ② `isInCohort()` is
    reserved for later targeting refinements).
  - **N is the real drift count, never copywriting.** The shell message must be true.
- **Attention ring:** 2px rotating conic-gradient border (Atlassian hues 蓝→紫→青→绿) around the
  **whole macro render**, painted with the two-layer background technique
  (`padding-box` fill over `border-box` conic-gradient — immune to z-index burying). Spins ~6s
  per appearance, then settles to a static gradient; `prefers-reduced-motion` gets static only.
- **CTA:** 「更新图表」 opens the existing macro editor (v1). Two-step plan: after ⑤ (#334) ships,
  v2 relands the CTA into the AI-assisted entry and the v1 baseline measures the delta.
- **Dismiss:** ✕ writes a localStorage marker (single-writer pattern shared with
  `warningBanner.ts` / `userCohorts.ts`), keyed per diagram×user context, silencing the hint for
  **30 days**.

## Trigger

Show only when ALL hold:

1. Surface is an **inline page-editor render** of the macro (not the edit modal, not fullscreen,
   not view mode). Detection mechanism = spike Q1.
2. **Drift ≥ 5**: the page has ≥5 new versions since the diagram's custom content was last
   modified. Computed at render time from `/wiki/api/v2/pages/{id}/versions` vs the custom
   content's last-modified — feasibility/latency = spike Q3; result cached per (pageId,
   pageVersion) in localStorage so the versions call runs at most once per page version.
3. No dismissal marker within 30 days for this diagram×user.
4. Feature flag `editor-staleness-hint-enabled` is ON (new Forge flag, prod-OFF by default per
   convention; read via the bridge SDK, never `invoke('getFlagValue')`).

v1 macro-type scope: sequence, mermaid, plantuml, graph. Excluded: embed (mirrors another
document — "update" is not its job) and openapi/asyncapi (spec-freshness semantics differ).

## Spike gates (must be answered with evidence before the implementation plan is finalized)

- **Q1 — surface detection:** in an inline page-editor render, what does the Forge extension
  context carry (`extension.macro.isConfiguring`? `entryPoint`? `modal` absent?) that
  distinguishes it from (a) the macro edit modal and (b) view mode? Current `isEditorish`
  (`forgeIndex.ts:283`) covers the modal + isConfiguring; the inline case needs its own signature.
- **Q2 — CTA clickability:** does the Confluence editor's extension selection overlay intercept
  clicks inside the macro iframe? If intercepted: fallback is a display-only strip pointing at the
  ✏️ toolbar button (copy: 「点击右上 ✏️ 更新」), CTA removed.
- **Q3 — versions API:** from the macro iframe (via `requestConfluence`), fetch page versions and
  count those newer than the diagram's last-modified: response shape, pagination behavior, and
  latency on a realistic page. Budget: ≤1s added on editor surfaces only (never blocks first
  paint; hint may appear late).

Method: ephemeral Playwright spike spec under `tests/e2e-tests/tests/spike/` against lite-stg
(reuse existing fixture pages; never delete test pages; `--workers=1`).

## Analytics (events land as the first implementation commit)

| Event | Fires | Key props |
|---|---|---|
| `staleness_hint_shown` | strip rendered | `drift_count`, `is_diagram_author`, `macro_type` |
| `staleness_hint_clicked` | CTA (or fallback-guidance interaction) | same |
| `staleness_hint_dismissed` | ✕ | same |

North-star join: first `macro_save_succeeded` per accountId within 7d of a
`staleness_hint_clicked`, where the accountId had no prior save. Growth contract (`/growth new`)
after ship.

## Out of scope

- AI-assisted CTA landing (v2, after ⑤).
- Page-banner or flag/toast variants (granularity mismatch; `showFlag` noted as unused fallback).
- Any use of the hint for entitlement/paywall logic — messaging only.
