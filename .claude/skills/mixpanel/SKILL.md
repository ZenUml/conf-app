---
name: mixpanel
description: Use when you need a Mixpanel fact or query path for the conf-app / ZenUML Confluence add-on — which project, which event name (and the 2026-04 rename), the internal-domain exclude filter, whether isForge/isLite/product_type is usable, MCP-vs-JQL, or how to authenticate. Canonical reference for Mixpanel project 3373228. Triggers on mixpanel, macro_viewed, view_macro, create_macro, edit_macro, JQL, is_internal_client_domain, product_type, isForge, "which mixpanel project", "how to query mixpanel". For churn/retention/growth/D1 analysis use the conf-app skill instead.
---

# Mixpanel (conf-app)

Canonical, pinned facts for querying Mixpanel for the ZenUML Confluence add-on. The point of this skill is **don't re-verify these** — they're settled (most are immutable history). For analysis/investigation (churn, retention, growth, cross-source D1 joins) use the **conf-app** skill, which delegates Mixpanel mechanics here.

## Which query path

| Situation | Path |
|---|---|
| **Interactive session** (you, a normal turn) | claude.ai Mixpanel MCP `mcp__claude_ai_Mixpanel__*`. Call **`Get-Business-Context` first** with `project_id=3373228` (it returns the internal-domain list, event semantics, and known traps for free), then `Run-Query` / `Get-Events`. |
| **Headless / `/loop` / cron / CI / must-be-reproducible** | `scripts/mp_query.py` (JQL API). The MCP needs interactive auth and is **absent** in headless runs. |
| Bulk / historical / offline / pre-2026-04 deep dives | the **duckdb-mixpanel** skill (local Parquet), not this. |
| ~~`mcp__mixpanel__Run-Query`~~ (the older MCP) | **Deprecated.** `growth` still uses it; migrate to the claude.ai MCP. |

## Immutable facts (don't re-derive)

- **Project:** `3373228` (conf-app + Diagramly + other apps are co-resident — always filter by domain/URL). The claude.ai MCP resolves it via `project_id=3373228`.
- **JQL auth:** `.env.mixpanel` → `API_Secret`; Basic auth = `base64("{API_Secret}:")`. `mp_query.py` loads it from cwd first, then the conf-app root. **Never echo or commit the secret value.**
- **Tracking starts 2026-04-18.** Any window starting earlier is empty/partial — never trust a 30/90d window blindly; check the earliest event date first.
- **`isForge` / `isLite` are dead** — effectively always `false`, even on events fired from Forge. Filtering `isForge=true` returns ~**zero**. Use **`product_type`** (`lite`/`full`/`diagramly`) for the *variant*. `product_type` does **not** encode Connect-vs-Forge runtime (see below).
- **`client_domain` = bare subdomain**, no `.atlassian.net` (e.g. `example-tenant`). D1's `clientDomain` is the full hostname — convert before joining the two stores.
- **`distinct_id` = `user_account_id`** (the Atlassian account), not tenant / macro / content id — **except when the Forge context had not resolved at send time.** Then it is the literal `unknown_user_account_id`, and `client_domain` is `unknown_atlassian_domain`. Both are shared constants, not per-user values, so **never count `unique` on an event that carries them** — every affected user collapses into one. Measured 30d to 2026-07-26 (178 event names, 969,584 events): fleet-wide loss is only **0.06%**, because every high-volume event fires after resolution (`macro_viewed`: 14 of 315,133). The loss is concentrated in early-boot events — `ai_aide_route_accessed` **100%**, `renderer_prefetch_started/completed` **35–37%**, `legacy_content_property_load_failed` **30%**, `cohorts_refresh_failed` 17%, `initializeContext` 100% (unavoidable — it fires *during* init). Re-measure with `.groupBy(['name', e => e.distinct_id === 'unknown_user_account_id' ? 'NO_USER' : 'ok'], mixpanel.reducer.count())`.
  - **Changing (PR #400, open 2026-07-26):** unresolved events will carry a Mixpanel-generated **anonymous** `distinct_id` instead of the literal, plus a localStorage SWR cache (`zenumlAccountId:<clientDomain>`) that attributes the first event of most iframes correctly. After it ships, **queries filtering on the `unknown_user_account_id` literal stop matching** — the population still exists, it is just anonymous and merged into the real user on the next identify. Check whether #400 is merged before trusting either shape.
- **Two more `unknown_*` traps when reading breakdowns:** `$mp_session_record` (Mixpanel's own session-replay event, ~372k/30d) carries **no** `client_domain` at all and will dominate any all-events domain breakdown. And project 3373228 is shared — a long tail of 100%-no-domain events (`home_page_viewed`, `signup_started`, `user_registered`, `otp_*`, `diagram_generated`, `brand_saved`, `pass_issued`…) belongs to **other products** (diagramly.ai, membership-card), not to conf-app. Excluding both, real domain loss is ~0.2%, not the 38.5% a naive breakdown shows.
- **`event_category` casing flipped:** `openapi` (pre-Nov 2025) → `OpenAPI` (post). Sum both.

## The 2026-04 event rename (evidence-verified)

Both names coexist **only in April 2026**; fully switched by May. **Window ≤ April 2026 → query both; May onward → current only.**

| Current (what the app emits — `catalog.ts`) | Legacy (pre-rename) |
|---|---|
| `macro_viewed` | `view_macro` |
| `macro_create_succeeded` | `create_macro_end` |
| `macro_save_succeeded` | `edit_macro_end` |

Other events were renamed in the same wave; **`src/utils/analytics/catalog.ts` is authoritative** for current names — read it, don't trust a stale copy here.

## Hot events (the ones you actually query)

| Event | Means | Key props / gotcha |
|---|---|---|
| `macro_viewed` | macro rendered on a page | `macro_type`, `client_domain`, `product_type`, `duration_ms`, `cache_state`. All viewers emit it, including graph (fixed by PR #224 — `ForgeGraphViewer.vue` calls `trackRenderTime('graph', …)` in `renderViewer()`; verified in code 2026-07-18). `macro_type='unknown'` signals failure **only** for sequence/mermaid/plantuml — graph/openapi/embed hardcode it. |
| `macro_create_succeeded` | new macro saved | `macro_type`, `client_domain` |
| `macro_save_succeeded` | existing macro saved | `macro_type`, `client_domain` |
| `macro_save_failed` | save failed | failure fields |
| `paywall_triggered` | Lite paywall shown at editor mount | `action_type` = `page_editor` \| `fullscreen_viewer`. Lite only. |
| `upgrade_modal_shown` | Lite upgrade modal shown | Forge + Lite only |

Full catalog + properties → conf-app `docs/analytics/events-catalog.md` + `src/utils/analytics/catalog.ts`. What an event *really means* (e.g. `customcontent_orphan_observed` ≠ "user saw broken macro") → conf-app skill `references/event-semantics.md`.

## Excluding internal / staging sites

- **MCP / Run-Query:** computed boolean `is_internal_client_domain = false` — one filter, verified equivalent to the manual list as of 2026-06 (`danshuitaihejie` added to the manual list 2026-07-03; re-verify the computed prop covers it before relying on exact equivalence).
- **JQL** (computed props unavailable there): exclude by `contains`/prefix with the canonical minimal set:
  ```
  ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]
  ```
  `"zenuml"` as a contains-match already catches `zenuml-connect` and `zenuml-stg`. `danshuitaihejie` is ruixiang's internal dev site — not a customer. `asyncapi-stg` is the AsyncAPI variant's E2E staging site (analogous to `full-stg`/`lite-stg`/`dia-stg`, one per variant) — missing from earlier versions of this list; confirmed 2026-07-16 it was leaking into a new-tenant JQL query (`asyncapi-stg` showed up as a "new customer" with 202 core events). This **supersedes the old `["zenuml","zenuml-stg","dia-stg"]`**, which under-excluded.

## Forge vs Connect runtime

There is **no reliable runtime boolean** (`isForge` is dead). To split:
- **By date:** the Connect→Forge migration was ~2026-04-23; after it, production is ~all Forge. The Full app has been Forge-only in prod since early 2026.
- **By D1 `appId`:** Connect `appId` is a small int (via `AppInstance`); Forge `appId` is a UUID (via `ForgeApp`). See the **conf-app** skill for D1 joins.

## Common mistakes (the re-verification killers)

| Mistake | Reality |
|---|---|
| Filter `isForge=true` / `isLite=true` | Returns ~zero — both dead. `product_type` for variant; date/`appId` for runtime. |
| Old exclude list `["zenuml","zenuml-stg","dia-stg"]` | Under-excludes. Use the canonical set or `is_internal_client_domain=false`. |
| `create_macro_end` for May-2026+ data | Renamed → 0. Use `macro_create_succeeded`. |
| `macro_viewed` for pre-April data | Didn't exist yet. Use `view_macro`. April = both. |
| Trust a 30/90d window | Tracking starts 2026-04-18. Check earliest date. |
| Join Mixpanel `client_domain` ↔ D1 `clientDomain` directly | Subdomain vs full hostname. Convert first. |
| `macro_type='unknown'` = failure for graph/openapi/embed | Only valid for sequence/mermaid/plantuml. |
| `macro_viewed` `surface='viewer'` = a real page view | On builds before 2026-07-19 (conf-app#368) the native macro-config surface was stamped `viewer` too, so historical viewer volumes include ~3% authoring renders — recognizable as no-`custom_content_id` events near `macro_create_started` by the same user, with inflated `duration_ms` (long-lived editor iframes, tab switches re-firing). Fixed in `ApWrapper2.isDisplayMode()`; segment by `app_version` across the fix. |

## JQL details

Rate limits, retry/back-off, chunking, and worked query examples → `references/jql-cookbook.md`. Runner → `scripts/mp_query.py --file query.js` (run from the conf-app root so `.env.mixpanel` is found).
