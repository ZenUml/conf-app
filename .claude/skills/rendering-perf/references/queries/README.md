# Worked JQL queries

Run from a directory containing `.env.mixpanel` (see the parent SKILL.md — in a remote
container, write `API_Secret=$MIXPANEL_API_SECRET` into a scratchpad `.env.mixpanel`):

```bash
python3 .claude/skills/mixpanel/scripts/mp_query.py \
  --file .claude/skills/rendering-perf/references/queries/<file>.js --pace 1
```

`from_date` / `to_date` are hardcoded to the 2026-07-25 baseline window — **edit them**
before reusing. All four apply the canonical internal-domain exclude list.

| File | Answers |
|---|---|
| `by-macro-type-with-phases.js` | The headline table: per-`macro_type` duration percentiles plus the bootstrap/context/fetch/render phase attribution. Visible-tab viewer renders only. |
| `by-tab-and-cache-state.js` | How much `tab_hidden` and `cache_state` distort the numbers, plus the `custom_content_fetch_ms` / `page_adf_fetch_ms` children of `fetch`. |
| `swr-cache-vs-fetch.js` | The content-SWR win: `swr_cache` vs `fetch` per macro type. Single day, so the SWR rollout is fully in effect across the window. |
| `daily-trend.js` | Daily n / p50 / p90 — use this to date a regression or a rollout, since it is the only view that separates "code changed" from "mix changed". |

Two reusable shapes worth lifting:

- **Pooled figure:** take any of these and replace the first key function with
  `function () { return "all"; }`. Percentiles do not compose across groups, so this is the
  only correct way to get an overall number.
- **Is property X live in prod yet?** `groupBy` day × `"x=" + (e.properties.x || "unset")`
  with `mixpanel.reducer.count()`. This is how the 2026-07-25 baseline established that
  content-SWR landed mid-day 07-23 and `render_gate` had not shipped at all — much cheaper
  than reading deploy logs, and it measures what users actually ran.
