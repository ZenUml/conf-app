---
name: engagement-review
description: Run the recurring (every two weeks) customer engagement review for the ZenUML Confluence app. Its goal is to find new improvement points and the next work direction (where new authors come from, who nearly became an author and what stopped them), not to report whether engagement went up — segment sites by authoring trend to know where to look, check what shipped changes did, read the new-author funnel by entry, pick directions with the owner, and run each direction and each product proposal in its own named session. Use for "engagement review", "参与度复盘", "双周复盘", "did anything we shipped raise engagement", "哪些改动提升了 engagement", or when the previous review's baseline is two weeks old.
---

# Engagement review

A review exists to **find causes and new improvement points, and from them the next work direction.** The owner's framing (2026-11-17): find where new authors come from, and who could have become an author but hit an obstacle and stopped. "Did engagement go up?" is a side check (step 2 and the 8-week rule), never the deliverable: a review that only reports a trend has missed its goal (2026-11-28: a run briefed as "did it improve" had to be redirected).

It runs every two weeks. Every second month (8 weeks) it also judges which growing sites held. Do not repeat earlier directions; read their pages first and report only what has new evidence.

This skill holds the method and the judgment rules. Mechanics live in other skills; findings and tenant names live in the private handbook, never here (this repo is public; see `docs/policies/client-privacy.md`).

## Inputs and outputs

| | What |
|---|---|
| Input | End date (a Sunday, UTC); the previous baseline `research/<date>-engagement-by-site-baseline.json` on private `origin/main`; the open directions table on the previous review page |
| Output 1 | New baseline JSON and a review page `research/<date>-engagement-by-site.md` in the private repo (`ZenUml/conf-app-private`), merged by PR |
| Output 2 | In chat: a ranked list of new improvement points (problem, evidence, size of the affected group, the event that would measure a fix) as numbered direction candidates for the owner; segment changes and shipped-change readings only as short context |
| Output 3 | One named session (or one page section, see below) per direction the owner picks |

## Dependencies

| Need | Where | If missing |
|---|---|---|
| Site segmentation and baseline compare | `site_trend.py` in the global **conf-app** skill (`~/.claude/skills/conf-app/scripts/`) | Not in remote containers. Say so and stop step 1; do not hand-derive segments |
| JQL, sampling, event names | **mixpanel** skill (`mp_query.py`, `mp_schema.py`, `mp_quota.py`) | — |
| Create funnel query | `research/2026-11-17-create-funnel-query.js` on private `origin/main` | — |
| Replays | Mixpanel MCP `Get-User-Replays-Data` | Headless: skip step 4 and say so |
| Owner's new idea | **search-conversation-history** skill | — |
| PR E2E scope | **pr-labeling** skill | — |
| Sessions | `mcp__ccd_session__start_session` | Headless or scheduled: write each direction as a section of the review page instead, and list them for the owner |

Read private files with `git -C private fetch origin main` and `git show origin/main:<path>`. Never checkout, stash or reset the private clone: other sessions work there.

## Steps

1. **Segment by site.** `site_trend.py --end <Sunday> --exclude <largest site> --out <scratch> --compare <previous baseline>`. Take the largest site's name from the previous baseline, not from memory. Report segment counts against the baseline, fleet authors and viewers without the largest site, and the largest site on its own.
2. **Read shipped changes.** List the changes released since the last review (release tags, `gh pr list --state merged`). For each with a plausible effect: before/after on the affected sites, a matched control group, and a placebo window. List other changes released in the same week before reading any before/after.
3. **New-author funnel by entry.** Split first-time create starts by `creation_origin` before blaming a diagram type or the editor. A byline tile click is a look, not a create attempt.
4. **Replays of real attempts only.** A real attempt is ≥2 minutes or ≥10 inputs. Before promising replay evidence for a surface, check its recording rate in `src/utils/window.ts` (while the October replay budget is active, the inline viewer records 0%).
5. **Owner picks directions.** End the readout with numbered `[AI]` options; multi-select allowed. An idea the owner brings: search conversation history first, then a read-only assessment session. Do not build it before that assessment.
6. **One named session per direction.** Name `eng-<letter>-<topic>`. Each writes its own page `research/<date>-direction-<letter>-<topic>.md`. The review page keeps a directions table (letter, question, session, page, state). The hub session only verifies and relays.
7. **Product proposals: discuss before code.** A proposal session's first deliverable is a discussion brief: current behaviour with code references, data, options, recommendation, and the events that would measure it. No code until the owner approves the details in that session.
8. **Measure intent before building variants.** When the reason behind a behaviour is unknown, ship the counting event first (Step A), wait about two weeks of data, then discuss the variant (Step B). Every new event states which question it answers and which result would change the decision.
9. **After a change ships:** a Mixpanel board plus an alert on the target metric, and a line in the next review's step 2.

## Judgment rules

- Never read the net fleet trend. Growth and decline cancel out; segment first.
- A growing site counts only after it holds 8+ weeks (B-window saves ≥67% of the earlier B window). A two-week review tracks; it does not judge.
- Many feature events are sampled from 2026-10-12. Extrapolate with `1 / sample_rate` inside the query; distinct-user counts of sampled events are floors.
- A week with almost no events is a missing-data gap until the code says otherwise. Before reading it as a behaviour change, check `sampleRateFor()` in `src/utils/analytics/eventSampling.ts` and the event's history in that file (`git log -G'<event>' -- src/utils/analytics/eventSampling.ts`). An event in `OCTOBER_STOP_EVENTS` gets rate 0: the browser drops it and stamps nothing. Map each change to its first release with `git tag --contains <commit>`.
- Known gap: `viewport_control_used` (Fullscreen, viewer and editor zoom) was stopped from 2026-10-12 (commit `8655d99f7`, first Lite `v2026.10.121121-lite`) to 2026-11-18 (commit `3d3367751`, first Lite `v2026.11.190129-lite`, the same release as wheel zoom). The few rows inside the gap come from builds older than the stop, and from `v2026.10.271752-full`, which sent everything from 2026-11-01 to about 11-04 because its budget window still ended with October. For zoom before and after comparisons, use September as the "before" period, not October or early November.
- A late-December week low in every segment is the holiday period, not an effect.
- Label any inference as an inference. A sub-session note is a report, not proof: check the PR state or `origin/main` before relaying it.

## How to present to the owner

- Tables name the numerator, denominator, window and filters (e.g. PNG only, internal sites excluded). If a percentage could be misread, work one row through.
- Explain a term in one plain sentence before asking the owner to choose about it.
- For an interaction change, offer a realistic prototype per diagram type before asking for design choices; pair it with a best-practice research session.
- E2E scope follows the change (pr-labeling), not the full suite by default. A new interaction needs both unit tests and an E2E scenario; if the E2E is deferred, say so and open it as a follow-up.
- Release only when the owner wrote it ("测试通过直接发布"); otherwise stop at merge.

## Previous reviews

Pages `research/2026-11-17-*.md` and `research/2026-11-18-direction-f-*.md` on private `origin/main` hold the first review (directions A–F). A one-time recheck task, `engagement-site-trend-recheck-2026-12`, runs on 2026-12-15.
