---
name: customer-timeline
description: Build the chronological timeline of every recorded fact for ONE Confluence tenant (Marketplace license and transactions, Mixpanel events, prod D1 tables, plus rows you pass in), with a source-coverage table and tracking-gap flags. Triggers on "完整时间线", "客户时间线", "customer timeline", "what did this customer do", "trial review timeline", "查这个租户所有数据源", "what happened on this site". Not for deciding whether to contact the customer (customer-followup), fleet-wide analysis (conf-app), or tracker writes (customer-tracker).
---

# Customer timeline

One tenant in, one merged timeline out. The script does the mechanical sweep; you judge what the rows and gaps mean.

## Input and output

Input: one identifier, a bare subdomain, a hostname, a cloudId, or a Marketplace entitlement id (`E-xxx-xxx-xxx-xxx`, or a license-details URL containing one). Optional `--from` / `--to` (UTC date or datetime; default: first Marketplace evidence to now), `--tz <IANA zone>` for the customer's local-time column (Australia/Melbourne is always added), and `--extra rows.json` (repeatable).

Output: rows `{ts_utc, source, event, certainty (fact | derived), props}` as JSON and as a markdown table, a coverage table (`rows found (n)` / `queried, empty` / `not queried (reason)` / `unavailable (error)` / `missing`), and gap flags. Files go to `--out` (default: a temp dir outside the repo). Customer data never goes into the repo; the script refuses `--out` inside a checkout unless it is under `private/`. Do not paste rows into PRs or issues.

## Run

```bash
python3 .claude/skills/customer-timeline/scripts/timeline.py <identifier> [--from 2026-11-01] [--to 2026-11-17] [--tz America/New_York] [--extra tickets.json] [--out DIR]
python3 .claude/skills/customer-timeline/scripts/timeline.py <identifier> --plan     # identity and window only, no D1 or Mixpanel query
python3 .claude/skills/customer-timeline/scripts/test_timeline.py                    # unit tests, no network
```

Reads from the primary checkout when run in a worktree: `marketplace.db`, `.env.mixpanel`, `wrangler.toml` and `node_modules` are gitignored. Set `CONF_APP_ROOT` if it lives elsewhere. A missing file or credential becomes a named coverage gap, never a crash. `--skip marketplace,mixpanel,d1` leaves a source out; `--allow-scan` lets it scan large unindexed D1 tables.

## What the script reaches

| Source | How | Traps it already handles |
|---|---|---|
| Marketplace | `marketplace.db` snapshot (`mp_report.py sync` refreshes it); license dates and transactions, no contacts | Snapshot age is printed in coverage. A site with no license (internal sites) falls back to D1 for its cloudId |
| Mixpanel | `mixpanel/scripts/mp_query.py --file`, `client_domain` = bare subdomain, 14-day chunks, property subset only | Starts 2026-04-18. Read the `mixpanel` skill before reading identity or sampling from the rows |
| D1 `conf-zenuml-prod` | `wrangler d1 execute ... --remote` as in `new-customers`, one statement per table, tenant column found with `pragma_table_info` at run time | Table gone = `missing`. No usable index = `not queried`. Row cap 2000, `TRUNCATED` is reported. Bodies, secrets, ciphertext and emails are never selected. Staging sites (`lite-stg`, `full-stg`) have no prod D1 rows |

## What needs agent tools, then `--extra`

Support desk tickets (`support-queue`), the support mailbox, the tracker workbook (`customer-tracker`, read only), session replay (Mixpanel MCP `Get-User-Replays-Data`), and Stripe or Slack. Gather those rows yourself, write them as `[{"ts_utc": ..., "source": "desk", "event": ..., "<anything else>": ...}]`, and pass `--extra`. They merge into the timeline and show in coverage. Say in your answer which of these you did not check.

## Judgement steps

1. Read coverage first. Quote any `unavailable`, `not queried`, `missing` or `TRUNCATED` source before drawing a conclusion. Empty is evidence only where the row says `queried, empty`.
2. Treat gap flags as leads. `sampled_events` means absence proves nothing. `start_without_terminal` and `silent_stretch` point at an editor that lost its terminal hook or a user who got stuck; open the replay if `authoring_without_replay` does not list it. `d1_vs_mixpanel_content` is `derived`: each side is a lower bound.
3. Mixpanel `macro_viewed` is a view of a macro, D1 `page_updated` is an editor action: do not add them. Keep `fact` and `derived` rows apart in the write-up.
4. Never state a cause from a timeline alone. A cause needs a reproduction (global rule).

Fleet comparison and baselines: `conf-app`. Whether to contact the customer and what to say: `customer-followup`. Tracker updates: `customer-tracker`.
