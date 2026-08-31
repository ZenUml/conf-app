---
name: mixpanel
description: Use when you need a Mixpanel fact or query path for the conf-app / ZenUML Confluence add-on — which project, which event name (and the 2026-04 rename), the internal-domain exclude filter, whether isForge/isLite/product_type is usable, MCP-vs-JQL, or how to authenticate. Canonical reference for Mixpanel project 3373228. Triggers on mixpanel, macro_viewed, view_macro, create_macro, edit_macro, JQL, is_internal_client_domain, product_type, isForge, "which mixpanel project", "how to query mixpanel". For churn/retention/growth/D1 analysis use the conf-app skill instead.
---

# Mixpanel (conf-app)

Canonical, pinned facts for querying Mixpanel for the ZenUML Confluence add-on. The point of this skill is **don't re-verify these** — they're settled (most are immutable history). For analysis/investigation (churn, retention, growth, cross-source D1 joins) use the **conf-app** skill, which delegates Mixpanel mechanics here.

## Event names and property names — ask the code, never this file

Names change; a prose list drifts. `scripts/mp_schema.py` derives every answer from the repo at call time and is the authority. **Run it before you put an event name or property into a query, a report, or a dashboard.**

```bash
S=.claude/skills/mixpanel/scripts/mp_schema.py
python3 $S doctor                          # is the working tree behind origin/main?
python3 $S event macro_viewed              # auto-enriched props + props from this event's emit sites
python3 $S check confluence_space          # declaration, doc comment, auto-enriched?, emit sites
python3 $S verify macro_viewed <property>  # LIVE fleet-wide: is it actually populated?
python3 $S events paywall                  # valid event names matching a pattern
python3 $S props space                     # declared properties matching a pattern
```

Sources it parses: `catalog.ts` (`AnalyticsEventName` union) for event names, `types.ts` (`AnalyticsProperties`) for the property vocabulary, the `enriched` literal in `trackAnalyticsEvent.ts` for what rides every event, and the tracker call sites for what rides a specific event. Add `--ref origin/main` when the working tree is behind — `doctor` tells you.

**Two traps it exists to stop** (both hit on 2026-08-11, building a per-tenant Usage board):

1. **A declared property is not a property of every event.** `space_key` is declared in `types.ts`, but it belongs to the Cloudflare backend's macro-count snapshot events. On `macro_viewed` it is 100% undefined — 81,878 of 81,878 events in a 7-day fleet-wide check. The space dimension on frontend events is **`confluence_space`**, which the tracker auto-injects (`trackAnalyticsEvent.ts`: `callerProps.confluence_space ?? getSpaceKey() ?? "unknown_space"`).
2. **Never validate a property against one tenant.** A single-tenant distinct count returns `1` for a completely absent property (counting the one value `undefined`) and also `1` for a real property at a one-space tenant. The two are indistinguishable. Fleet-wide they differ by three orders of magnitude. `verify` is fleet-wide by construction and reports the undefined-only case as `VERDICT: UNUSABLE`.

Section comments in `types.ts` are organisational, not authoritative — `confluence_space` sits under "Contextual" yet is auto-injected. `mp_schema.py` reads the runtime object, not the comment.

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

- **MCP / Run-Query / saved reports:** use the computed event property `is_internal_client_domain`, string-encoded as `equals "false"` so saved-report URLs preserve the filter:
  ```json
  {"type":"string", "propertyName":"is_internal_client_domain", "propertyType":"string", "resource":"event", "operator":"equals", "value":"false"}
  ```
  This is the single source of truth for customer-wide Mixpanel reports. Do **not** build one `client_domain` filter per internal site. The superficially similar `is_internal_domain` is not the conf-app classifier: on 2026-08-22 it produced no internal (`true`) bucket, while `is_internal_client_domain` separated 4,055 internal `macro_viewed` events in the same seven-day window.
- **JQL** (computed props unavailable there): before querying, load the customer-specific exclusions from [`private/operations/internal-analytics-domain-exclusions.md`](../../../private/operations/internal-analytics-domain-exclusions.md) and combine them with this public baseline. Keep tenant identifiers in that private reference, never in this skill. Exclude by `contains`/prefix with the baseline:
  ```
  ["zenuml", "whimet", "full-stg", "lite-stg", "lite-dev", "lite-prod", "dia-stg", "asyncapi-stg", "diagramly", "danshuitaihejie"]
  ```
  `"zenuml"` as a contains-match already catches `zenuml-connect` and `zenuml-stg`. `danshuitaihejie` is ruixiang's internal dev site — not a customer. `asyncapi-stg` is the AsyncAPI variant's E2E staging site (analogous to `full-stg`/`lite-stg`/`dia-stg`, one per variant) — missing from earlier versions of this list; confirmed 2026-07-16 it was leaking into a new-tenant JQL query (`asyncapi-stg` showed up as a "new customer" with 202 core events). This **supersedes the old `["zenuml","zenuml-stg","dia-stg"]`**, which under-excluded. `lite-prod` (Lite production-environment internal site) added 2026-08-24, in both this baseline and the `is_internal_client_domain` custom property (id `5870902`).

  **The two lists are not identical — check both when adding a domain.** As of 2026-08-24 the custom property carries `async-prd` (absent from this JQL baseline) and the JQL baseline carries `danshuitaihejie` (absent from the custom property). Neither gap has been closed; a domain added to one does not propagate to the other.

## Forge vs Connect runtime

There is **no reliable runtime boolean** (`isForge` is dead). To split:
- **By date:** the Connect→Forge migration was ~2026-04-23; after it, production is ~all Forge. The Full app has been Forge-only in prod since early 2026.
- **By D1 `appId`:** Connect `appId` is a small int (via `AppInstance`); Forge `appId` is a UUID (via `ForgeApp`). See the **conf-app** skill for D1 joins.

## Common mistakes (the re-verification killers)

| Mistake | Reality |
|---|---|
| Filter `isForge=true` / `isLite=true` | Returns ~zero — both dead. `product_type` for variant; date/`appId` for runtime. |
| Per-domain exclusions in MCP reports | They drift. Use the string-encoded `is_internal_client_domain = "false"` filter; only raw JQL needs the canonical/private domain list. |
| `create_macro_end` for May-2026+ data | Renamed → 0. Use `macro_create_succeeded`. |
| `macro_viewed` for pre-April data | Didn't exist yet. Use `view_macro`. April = both. |
| Trust a 30/90d window | Tracking starts 2026-04-18. Check earliest date. |
| Join Mixpanel `client_domain` ↔ D1 `clientDomain` directly | Subdomain vs full hostname. Convert first. |
| `macro_type='unknown'` = failure for graph/openapi/embed | Only valid for sequence/mermaid/plantuml. |
| `space_key` as the space dimension on frontend events | Undefined on `macro_viewed` (0 of 81,878 fleet-wide, 7d). It belongs to backend macro-count snapshot events. Use **`confluence_space`**. Check with `mp_schema.py verify <event> <prop>`. |
| Validating a property against ONE tenant | A distinct count returns 1 both for an absent property (the value `undefined`) and for a real property at a one-space tenant. Always verify fleet-wide. |
| `BooleanPropertyFilter` in MCP `Run-Query` when the output is a link or saved report | The executed query is correct, but the encoded state is malformed: the shared `report_url` re-runs with the filter flipped to `= true`, and a saved report (bookmark updated via query_id) renders the chip as `True` AND reverts every viewer edit — clicking 30D snaps back to the saved range because the UI cannot re-serialize the filter (hit 2026-07-23 and 2026-08-19, Coles board reports 91672617/91672628). Fix: string-encode boolean filters. For `tab_hidden`, use `{type:"string", propertyType:"string", operator:"equals", value:"false"}`; for customer-wide reports, use the `is_internal_client_domain` filter shown above. It returned the same 76,052-event seven-day population as the native boolean form on 2026-08-22. Results returned inline in the tool response are trustworthy either way. |
| `macro_viewed` `surface='viewer'` = a real page view | On builds before 2026-07-19 (conf-app#368) the native macro-config surface was stamped `viewer` too, so historical viewer volumes include ~3% authoring renders — recognizable as no-`custom_content_id` events near `macro_create_started` by the same user, with inflated `duration_ms` (long-lived editor iframes, tab switches re-firing). Fixed in `ApWrapper2.isDisplayMode()`; segment by `app_version` across the fix. |

## JQL details

Rate limits, retry/back-off, chunking, and worked query examples → `references/jql-cookbook.md`. Runner → `scripts/mp_query.py --file query.js` (run from the conf-app root so `.env.mixpanel` is found).
