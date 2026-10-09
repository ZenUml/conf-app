# Premise re-measure and creator-funnel decomposition (as of 2026-10-06)

All counts are external tenants only. Filters used: `client_domain` set and not internal (the public JQL baseline plus the one entry in `private/operations/internal-analytics-domain-exclusions.md`) and `okUser` (excludes `unknown_user_account_id` and `$device:`). A distinct_id shape check found 100% of current-30d `macro_viewed`/create/save ids have `user_account_id == distinct_id`. Of those, 99.7% match an Atlassian accountId pattern and 0 are anonymous (`premise_a2_id_shape.js`). All events used have sample rate 1. `app_first_seen` is not sampled; a backend env switch muted it (see A0). Query files are in `docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_*.js`. Raw outputs are in the scratchpad `premise/` folder.

## A0. The page-active denominator does not exist for the current 30d
`app_first_seen` (backend-imported from the page-banner ping, distinct_id == account_id on 208,295/208,295 events) is effectively silent externally in 2026-09-06..10-05:
| variant | census days with volume | external events after the census |
|---|---|---|
| lite | 2026-08-09..08-26 (18 d) | ≤9/day from 08-27 |
| diagramly | 08-09..08-26 (18 d) | 0 from 08-28 |
| full | 08-21..09-09 (20 d) | ≤1/day from 09-10 |
| asyncapi | 08-18..08-28 (11 d) | ~0 from 08-29 |
Source: `premise_a0_firstseen_split.js`. Mechanism (READ_FROM_CODE): kill switch `FIRST_SEEN_DISABLED` at `functions/forge-user-behavior.ts:45`. When it is on, the client writes its 30-day marker as if the ping succeeded (`src/utils/firstSeen/firstSeenPing.ts`). Which env flip happened on which date per Pages project is UNKNOWN; I did not read Cloudflare. **So every ratio below uses a matched census window: numerator and denominator come from the same 18/20/11 days.** A 30d window would increase both sides. Anchor A2 (79,221 accounts / 741 sites) also held only about 14 census days (08-09..08-22), so the like-for-like comparison is Lite 84,531 accounts / 754 tenants over 18 days.

## A. Premise per tenant (matched census window; `premise_a1_tenant_user_flags.js`)
Fleet totals (distinct account × tenant):
| variant | tenants w/ page-active | page-active accts | macro viewers | (viewer surface) | creators | editors | authors (C∪E) | viewers/PA pooled | authors/PA pooled |
|---|---|---|---|---|---|---|---|---|---|
| lite | 754 | 84,531 | 7,613 | 7,518 | 579 | 526 | 695 | 9.0% | 0.82% |
| full | 95 | 11,706 | 1,350 | 1,343 | 128 | 115 | 147 | 11.5% | 1.26% |
| diagramly | 28 | 904 | 26 | 25 | 1 | 0 | 1 | 2.9% | 0.1% |
| asyncapi | 12 | 313 | 1 | 1 | 1 | 1 | 1 | ~0 | ~0 |

Per-tenant distribution, tenants with ≥10 page-active accounts:
| variant | n tenants | viewers/PA p25 / median / p75 | authors/PA p25 / median / p75 | authors 0 / 1 / 2–3 / 4+ | viewer share <5% / 5–15% / 15–30% / >30% |
|---|---|---|---|---|---|
| lite | 489 | 0.0% / 4.5% / 11.1% | 0 / 0 / 0.7% | 322 / 77 / 44 / 46 | 257 / 145 / 59 / 28 |
| full | 62 | 0.0% / 5.6% / 14.9% | 0 / 0 / 1.5% | 35 / 10 / 10 / 7 | 28 / 18 / 11 / 5 |
| diagramly | 15 | median 0 | median 0 | 14 / 1 / 0 / 0 | 14 / 0 / 1 / 0 |
| asyncapi | 7 | 0 | 0 | 7 / 0 / 0 / 0 | 7 / 0 / 0 / 0 |

- Concentration: the top tenant holds 9.8% of Lite page-active accounts (top 5: 25.7%, top 10: 36.7%). For Full it is 32.2% (top 5: 56.6%). Lite pooled without the top tenant: 9.8% viewers, 0.88% authors. Full without its top tenant: 9.9% / 1.03%.
- Lite by tenant size (PA accounts): 10–49 → 255 tenants, 133 with zero viewers, median 0. 50–199 → 159 tenants, median 4.9% viewers / 0 authors. 200–999 → 58 tenants, median 9.5% / 0.58%. ≥1000 → 17 tenants, median 6.6% / 0.63%.
- Lite tenants with at least one census viewer (n=327): median viewers/PA 8.3% (p25 4.5%, p75 15.2%), median authors/PA 0.22%.
- Pooled authors÷viewers: Lite 9.1% in the census window, 11.6% in the current 30d. Full 10.9% / 11.3%. Median per tenant among tenants with authors: Lite 12.3%, Full 14.3%.
- Verdict on the premise: **the pooled fleet figure matches (~9–11% view, ~0.8–1.3% author). The "most customers" framing does not: the median tenant is below 5% viewers and has 0 authors.** 66% of Lite tenants (322/489) had zero authors in the census window.
- Current 30d numerators (2026-09-06..10-05, no current denominator): Lite viewers 9,640 (viewer surface 9,518), creators 968, editors 846, authors 1,121. Full: 1,710 / 1,699 / 165 / 164 / 193. Tenants with ≥10 viewers: Lite 142 (authors 0 / 1 / 2–3 / 4+ = 9 / 28 / 42 / 63), Full 23 (1 / 3 / 9 / 10). Current authors÷viewers per tenant (≥10 viewers): Lite median 10.9% (p25 7.7%, p75 15.6%), Full median 11.4%. ESTIMATED cross-window ratio, current 30d numerator ÷ census PA: Lite median viewers 5.5%, authors 0.
- Anchors: A1 Lite viewer-surface viewers 10,125 (07-23..08-22) → now **9,518** (−6%). A1' never-created since 04-18: 79% → now **7,238 / 9,516 = 76.1%** Lite and 1,334 / 1,699 = 78.5% Full (`premise_a3_viewers_never_authored.js`). A2: see A0.

## B. C-tier (Lite; definition: ≥10 distinct readers, ≤3 creators, ≤3 savers over 60d; `premise_b1_ctier.js`)
| training window | tenants w/ signal | ≥10 readers | C0 | C1 | C2 | total |
|---|---|---|---|---|---|---|
| Aug reproduction 2026-05-05..07-03 | 456 | 180 | 14 | 22 | 49 | **85** (Aug study: 84 = 14/21/49) |
| now 2026-08-07..10-05 | 472 | 185 | 16 | 28 | 52 | **96** |
- Aug cohort (85) status now: 40 still C-tier (C0 7, C1 12, C2 21). 17 exited upward (≥10 readers and >3 creators or savers in 60d). 28 dropped below 10 readers. 56 tenants are new to C-tier.
- **Graduated (≥4 authors in 2026-09-06..10-05): 9 of 85 (10.6%).** Current-30d author counts across the cohort: 0 → 30, 1 → 25, 2–3 → 21, ≥4 → 9. Two tenants had no signal at all in the current 60d.
- Sensitivity now vs August (min readers/max authors): 5/1 → 109 vs 106. 5/3 → 181 vs 173. 10/1 → 44 vs 36. 10/5 → 127 vs 110. 20/3 → 36 vs 32.

## C. Authoring funnel
**C0. When the events went live externally** (`premise_c0_terminal_first_dates.js`): `macro_authoring_ended` first appeared on **2026-10-05** for both lite and full. That gives 1 full day plus partial 10-06, so every decomposition below is a 1–2 day sample. `macro_edit_cancelled` / `macro_create_cancelled` appeared on Lite 2026-09-13 and Full 09-30 / 10-04. Diagramly and asyncapi have none.

**C1. Instrumentation gaps (findings in their own right)**
- On Lite, 521/580 `macro_authoring_ended` events (10-05) carry no `macro_type` or `operation_mode`. The sequence/mermaid/plantuml path in `src/forgeIndex.ts` never calls `setEditJourneyMeta`; graph, openapi and embed do. `macro_create_started` / `macro_edit_started` carry no `journey_id` (`forgeIndex.ts:1006-1020`). My workaround (`premise_c2_authoring_ended_joined.js`) matches each terminal event to the latest preceding start of the same user, preferring the same `macro_uuid`, within 6h.
- `macro_create_started.macro_type` defaults to `sequence` for new sequence-family macros (`forgeIndex.ts:1003`). The start type therefore does not predict the saved type. Lite "sequence" create starts: 896 users / 5,195 events, only 4% converting to a same-type success but 85% to any-type.
- `had_input` is absent on **every** `cancelled` outcome (Lite edit 290/290). It is absent by design on graph/openapi/embed. So "typed and gave up vs typed nothing" can only be answered for `window_close`/`saved` on text-DSL editors.
- The two terminal events disagree. `macro_authoring_ended{cancelled}` on Lite mermaid edits = 221 in 2 days, but `macro_edit_cancelled` on Lite mermaid = 22 in 23 days (`premise_c4_edit_cancelled.js`). Not resolved.
- `had_changes=false` on 100% of graph/openapi cancels (Lite edit graph 122, openapi 71; create graph 90, openapi 8). Read this as UNKNOWN (probably not instrumented), not as "no changes".
- Starts vs terminal events: Lite on 10-05 had 630 starts (328 create + 302 edit) and 580 ended (92%). Full had 99 starts and 72 ended (73%). On 10-06 (partial) ended exceeds starts (Lite 473 starts vs 635 ended; Full 77 vs 117). Per-op reconciliation over the 2 days: Lite create 571 starts vs 436 attributed ends, Lite edit 532 vs 782.

**C2. Outcome distribution, 2026-10-05..10-06, attributed** (`premise_c2_authoring_ended_joined.js`)
| variant/op | ended | saved | window_close | cancelled | non-save text-DSL had_input true / false / absent | non-save graph/openapi/other (absent) |
|---|---|---|---|---|---|---|
| lite create | 436 | 370 (85%) | 65 | 1 | 42 / 8 / 2 | 14 |
| lite edit | 782 | 331 (42%) | 161 | 290 | 20 / 38 / 296 | 97 |
| full create | 53 | 53 | 0 | 0 | — | — |
| full edit | 136 | 58 | 31 | 47 | 1 / 5 / 47 | 25 |
Lite create by type: mermaid 303 saved / 36 window_close / 1 cancelled. Sequence 46 / 15. Graph 12 / 7. Openapi 8 / 4. Embed 0 / 1. Asyncapi 0 / 2. Lite edit by type: mermaid 232 saved / 51 window_close / 221 cancelled. Plantuml 56 / 12 / 58. Graph 21 / 53. Openapi 18 / 39. **Among Lite create non-saves on text-DSL editors with input recorded, 42/50 had typed something (`had_input=true`).**

**C3. Start → success within 1h, same user, current 30d.** User-level by op (`premise_c5_start_to_success_1h_op.js`):
| variant | create users | converted | rate | edit users | converted | rate |
|---|---|---|---|---|---|---|
| lite | 1,284 | 958 | 74.6% | 1,039 | 826 | 79.5% |
| full | 193 | 160 | 82.9% | 184 | 160 | 87.0% |
| diagramly | 1 | 1 | — | 1 | 1 | — |
| asyncapi | 1 | 1 | — | 2 | 1 | — |
The A3 anchor was 70.7% (752/1,064, Lite create, any success in 30d), so this is not the same definition. The per-type rows below count user×type instances; a success of any type counts (`premise_c3b_start_to_success_1h_anytype.js`):
| lite create | instances | conv | lite edit | instances | conv |
|---|---|---|---|---|---|
| sequence-family default (`sequence`) | 896 | 85% | mermaid | 746 | 84% |
| mermaid | 347 | 62% | plantuml | 58 | 74% |
| graph | 212 | 60% | sequence | 24 | 83% |
| openapi | 89 | 52% | graph | 163 | 67% |
| embed | 19 | 68% | openapi | 95 | 64% |
| asyncapi | 19 | 21% | markdown | 10 | 90% |
Full create: sequence-default 164 → 87%, mermaid 30 → 90%, graph 22 → 55%, openapi 12 → 67%. Full edit: mermaid 139 → 84%, graph 15 → 80%, openapi 22 → 73%, plantuml 20 → 95%, sequence 15 → 100%. Starts per user are high (Lite create sequence 5.8, Lite edit plantuml 11.6), so event-level rates (83–93%) overstate conversion. Use the user-level rates.

## D. Creator retention (`premise_d1_author_days.js`)
Definition: first observed create (`macro_create_succeeded` ∪ legacy `create_macro_end`) since 2026-04-18, merged across variants. "Retained" means any create or save on days +1..+30 / +1..+60 after the first-create day; the first-create day itself is excluded. The May cohort is left-censored, because creators from before 04-18 look new. June and July are the clean cohorts.
| first-create cohort | n | +1..30d | +1..60d | +8..30d (returned after week 1) |
|---|---|---|---|---|
| May 2026 | 880 | 55.6% | 61.7% | 37.2% |
| **June 2026** | 652 | **51.2%** | **57.1%** | 33.0% |
| **July 2026** | 591 | **54.5%** | **60.9%** | 34.7% |
| Aug 2026 | 518 | 50.6% | (censored) | 32.6% |
Author-to-author (account × product_type, prior 30d 08-07..09-05 → current 30d 09-06..10-05):
| variant | prior authors | current authors | retained | rate | current authors new vs prior |
|---|---|---|---|---|---|
| lite | 985 | 1,121 | 361 | 36.6% | 760 |
| full | 180 | 193 | 75 | 41.7% | 118 |
| diagramly | 3 | 1 | 1 | — | 0 |
| asyncapi | 1 | 1 | 0 | — | 1 |
266 legacy-era authoring accounts have product_type undefined and are excluded from the per-variant rows.

## E. Reader breadth per diagram (`premise_e1_reader_breadth.js`)
Key: `client_domain` + `custom_content_id`. The id was checked with `mp_schema.py verify`: present on 363,517/388,470 fleet `macro_viewed` events (30d) and on 100% of create/save events. Only `macro_viewed` with surface=viewer, current 30d.
| variant | diagrams viewed | viewers p25 / median / p75 / p90 | 1 / 2–4 / 5–9 / 10–49 / 50+ viewers | share of views from diagrams with ≥10 viewers |
|---|---|---|---|---|
| lite | 22,134 | 1 / 2 / 3 / 6 | 11,055 / 7,728 / 2,552 / 799 / 0 | 29.0% |
| full | 2,764 | 1 / 2 / 4 / 9 | 1,198 / 986 / 348 / 231 / 1 | 47.8% |
These counts include the author's own views.
- Viewer ≠ author: the author set for a content id is everyone with a create/save on that id since 2026-04-18. **MEASURED on diagrams with a known author** (Lite 12,400 of 22,134; Full 1,869 of 2,764): Lite 46.8% of views and 75.9% of viewer instances come from non-authors. Full: 48.8% / 81.1%. Across all diagrams the non-author share of views (Lite 56.6%, Full 54.7%) is an upper bound, because 44% of Lite diagrams have no author observed since 04-18. Authors before April are UNKNOWN.

## F. Anonymous viewing
Commit c7fb3658 "fix(forge): allow anonymous macro rendering" (2026-10-06 17:04 +11:00) merged in PR #732. It is contained in tags v2026.10.062042-lite / -diagramly / -asyncapi; Lite was published 2026-10-06 11:26:58Z. The Full tags are still Draft. It falls outside every window here. From 2026-10-06, anonymous viewers may appear on `macro_viewed` with non-account distinct_ids, so the `okUser` filter and all unique-viewer counts need re-validation.


## FACTS
- [MEASURED] app_first_seen is effectively silent externally in the current 30d window. Census days: lite/diagramly 2026-08-09..08-26, full 08-21..09-09, asyncapi 08-18..08-28. distinct_id == account_id on 208,295/208,295 events — queries/premise_a0_firstseen_split.js, 207 rows
- [READ_FROM_CODE] The kill switch FIRST_SEEN_DISABLED makes the backend answer {disabled:true}, and the client then writes its 30-day marker as if the ping succeeded — functions/forge-user-behavior.ts:45; src/utils/firstSeen/firstSeenPing.ts
- [MEASURED] Lite census window (18d): 84,531 page-active accounts across 754 tenants; 7,613 macro viewers (9.0%); 695 authors (0.82%) — queries/premise_a1_tenant_user_flags.js, 3,580 rows
- [MEASURED] Full census window (20d): 11,706 page-active accounts; 1,350 viewers (11.5%); 147 authors (1.26%) — queries/premise_a1_tenant_user_flags.js
- [MEASURED] Lite tenants with ≥10 page-active accounts (n=489): median viewers/PA 4.5% (p25 0, p75 11.1%); median authors/PA 0 (p75 0.7%); author buckets 0/1/2-3/4+ = 322/77/44/46; viewer-share buckets <5/5-15/15-30/>30% = 257/145/59/28 — queries/premise_a1_tenant_user_flags.js
- [MEASURED] Full tenants with ≥10 PA (n=62): median viewers/PA 5.6%, median authors 0; author buckets 35/10/10/7; viewer-share buckets 28/18/11/5 — queries/premise_a1_tenant_user_flags.js
- [MEASURED] Top tenant holds 9.8% of Lite page-active accounts and 32.2% of Full's — queries/premise_a1_tenant_user_flags.js
- [MEASURED] Current 30d Lite: 9,640 viewers (9,518 on the viewer surface), 968 creators, 846 editors, 1,121 authors. Full: 1,710 / 1,699 / 165 / 164 / 193 — queries/premise_a1_tenant_user_flags.js
- [MEASURED] Current 30d Lite viewer-surface viewers with no create/save since 04-18: 7,238 of 9,516 (76.1%), against the A1' anchor of 79% — queries/premise_a3_viewers_never_authored.js, 13 rows
- [MEASURED] Reproduced the August C-tier at 85 tenants (C0 14 / C1 22 / C2 49) vs 84 in the study. The current 60d C-tier is 96 tenants (16 / 28 / 52) — queries/premise_b1_ctier.js, 2,951 rows
- [MEASURED] 9 of the 85 August C-tier tenants graduated (≥4 authors in 2026-09-06..10-05); 40 are still C-tier; 17 exited upward on a 60d basis; 28 dropped below 10 readers — queries/premise_b1_ctier.js
- [MEASURED] macro_authoring_ended first appeared externally on 2026-10-05 (lite and full) — queries/premise_c0_terminal_first_dates.js, 191 rows
- [READ_FROM_CODE] The sequence-family editor path never sets journey meta, so most Lite macro_authoring_ended events lack macro_type and operation_mode (521/580 on 10-05). Start events carry no journey_id — src/forgeIndex.ts:1006-1020 (no setEditJourneyMeta call); src/utils/journeyTracking.ts:92-97,147-148; queries/premise_c1_authoring_ended.js, 128 rows
- [READ_FROM_CODE] macro_create_started.macro_type defaults to 'sequence' for new sequence-family macros — src/forgeIndex.ts:1003
- [MEASURED] had_input is absent on every 'cancelled' authoring_ended outcome (Lite edit 290/290) — queries/premise_c2_authoring_ended_joined.js, 61 rows
- [MEASURED] Lite create journeys over 2026-10-05..06: 436 attributed ends; 370 saved (85%), 65 window_close, 1 cancelled. Of text-DSL non-saves with input recorded, 42 had input and 8 did not — queries/premise_c2_authoring_ended_joined.js
- [MEASURED] Lite mermaid edits: macro_authoring_ended{cancelled} = 221 in 2 days, but macro_edit_cancelled = 22 in 23 days — queries/premise_c2_authoring_ended_joined.js; queries/premise_c4_edit_cancelled.js, 50 rows
- [MEASURED] Same-user start→success within 1h, current 30d: Lite create 958/1,284 (74.6%), Lite edit 826/1,039 (79.5%), Full create 160/193 (82.9%), Full edit 160/184 (87.0%) — queries/premise_c5_start_to_success_1h_op.js, 13 rows
- [MEASURED] Creator retention for first-create cohorts: June 652 → 51.2% create/save again within +1..30d and 57.1% within +1..60d; July 591 → 54.5% / 60.9% — queries/premise_d1_author_days.js, 4,295 rows
- [MEASURED] Author-to-author retention from prior 30d to current 30d: Lite 361/985 (36.6%), Full 75/180 (41.7%) — queries/premise_d1_author_days.js
- [MEASURED] Lite diagrams viewed in the current 30d: 22,134; median 2 distinct viewers (p75 3, p90 6); 11,055 had exactly 1 viewer — queries/premise_e1_reader_breadth.js, 115 rows
- [MEASURED] On Lite diagrams with a known author since 04-18, 46.8% of views and 75.9% of viewer instances are from non-authors (Full: 48.8% / 81.1%) — queries/premise_e1_reader_breadth.js
- [READ_FROM_CODE] The anonymous macro rendering commit c7fb3658 is in v2026.10.062042-lite (published 2026-10-06T11:26:58Z), -diagramly and -asyncapi. Full is still a Draft — git merge-base --is-ancestor c7fb3658 <tag>; gh release view v2026.10.062042-lite

## OPEN QUESTIONS
- No page-active denominator exists for 2026-09-06..10-05 because app_first_seen was muted. Should the panel accept the 18-day matched census ratio, or should the ping be re-enabled to get a current monthly denominator?
- When was FIRST_SEEN_DISABLED flipped on each Cloudflare Pages project? Mixpanel suggests Lite/Diagramly ~08-26/27 and Full ~09-09/10. Not verified in Cloudflare.
- Why does macro_authoring_ended{cancelled} (221 mermaid edits in 2 days) disagree by ~100x with macro_edit_cancelled (22 in 23 days) for the same editor?
- Is had_changes=false on graph/openapi cancels real or an uninstrumented default?
- Was each non-author viewer a page reader or a page editor? Edit permission of viewers is still unmeasured (A9 is still UNKNOWN).
- Authors of diagrams created before 2026-04-18 are invisible. 44% of Lite viewed diagrams have no known author, so the viewer≠author share is measured only on the known-author subset.
- After anonymous rendering shipped on 2026-10-06, does macro_viewed carry non-account distinct_ids? The okUser filter needs re-validation for any window after that date.

## FILES
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_a0_firstseen_split.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_a1_tenant_user_flags.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_a2_id_shape.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_a3_viewers_never_authored.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_b1_ctier.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_c0_terminal_first_dates.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_c1_authoring_ended.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_c2_authoring_ended_joined.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_c3_start_to_success_1h.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_c3b_start_to_success_1h_anytype.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_c4_edit_cancelled.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_c5_start_to_success_1h_op.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_d1_author_days.js
- docs/analysis/2026-10-06-user-engagement-strategy/queries/premise_e1_reader_breadth.js
