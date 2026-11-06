# PR #1073 — does moving Connect MCP into the More menu reduce inline exposure?

**Outcome (2026-11-07):** the move was reverted in `826e9602`; the inline header button stays for every viewer, as on main. This note is the data that informed that decision.

Queried 2026-11-07 (Mixpanel project 3373228, Insights/Funnels via the Mixpanel MCP).
Window: last 30 days (≈ 2026-10-08 → 2026-11-06). The header button started emitting
`agent_link_mcp_button_shown` the week of 2026-10-12, so the window covers its whole life.
Filters on every query: `is_internal_client_domain = "false"` (customers only) and
`product_type != "diagramly-web"` (`agent_link_*` names are shared with diagramly.ai).

## Current header button (main)

| Measure | Value |
|---|---|
| Unique users shown the button (`agent_link_mcp_button_shown`) | 6,230 (viewer 6,226; ~3,000/week since 2026-10-19) |
| `shown` events by placement | viewer `toolbar` 16,966 · viewer `more_menu` (stage 3) 213 · fullscreen `toolbar` 45 |
| `agent_link_mcp_dialog_opened` | 19 events / 18 users (0.29% of users shown) — 6, 4, 6, 3 per week |
| Opens from the More menu (`action_location = header_more_menu`) | 0 — all 19 from the header button (18 viewer, 1 fullscreen) |
| `agent_link_mcp_dialog_copied` (users) | 2 |
| Shown users who later started an edit (`macro_edit_started`, 30-day funnel) | 708 of 6,230 (11%) |
| Users who started an edit and later opened the dialog | 7 of 1,286 editors (1%) |

Reports: [shown/opened/copied by surface × placement](https://mixpanel.com/project/3373228/view/3879592/app/insights#zoj65LUmTnBK) ·
[weekly trend](https://mixpanel.com/project/3373228/view/3879592/app/insights#HLAvHLzcu19X) ·
[shown → edit funnel](https://mixpanel.com/project/3373228/view/3879592/app/insights#vcfFBPk8Z9ah) ·
[edit → open funnel](https://mixpanel.com/project/3373228/view/3879592/app/insights#T6ZHDuA5hkyv)

## Reach of the inline More menu (where this PR moves the entry)

`viewer_more_menu_opened` is in the event-budget reduced list (10% from the week of
2026-10-12, stamped `sample_rate = 0.1`), so raw counts must be scaled.

| Week | Raw events (unsampled + sampled) | Estimated opens |
|---|---|---|
| 2026-10-19 | 0 + 15 | ~150 |
| 2026-10-26 | 0 + 14 | ~140 |
| 2026-11-02 | 2 + 18 | ~180 |

[Report](https://mixpanel.com/project/3373228/view/3879592/app/insights#jTjto5HbrVJT)

## Reading

- Inline, roughly 150–180 More-menu opens a week against ~3,000 people a week who see the
  header button today: the inline entry will be in front of roughly 5% of today's audience
  (opens are events, so the people count is at most that).
- What is at stake is ~4 dialog opens a week and 2 copies in 30 days. At today's 0.3% rate
  the menu would yield well under one open a week, unless menu openers convert better
  (they chose to explore the header, so they may).
- The "editors only" gate checks edit permission, not editing; most licensed Confluence users
  can edit pages, so it removes far fewer viewers than the 89% who never edit.
- The Fullscreen card and editor surfaces need to recover ~4 opens a week to break even.

## Limits

- Small numbers (19 opens): compare placements over several weeks, not days.
- `shown` is deduped per viewer per UTC day; user counts are the comparable unit.
- Funnels are ordered (shown before edit), so 11% is a lower bound for shown users who edit.
