---
name: paywall
description: Manage the ZenUML Lite paywall rollout (Lite variant only — Full and Diagramly have no restrictions). Decide which domains to enroll in CUSTOMER_SUCCESS_SERVICE (CSS), monitor daily paywall activity, and generate the exact KV commands to execute. Use this skill whenever the user asks about paywall rollout, which clients to enable, the CSS flag, tenant enrollment state, space licensing, or "who should be on the paywall list". Also use when the user asks to check a specific domain's paywall state, wants to understand why a tenant is or isn't seeing the paywall, or wants to A/B compare paywall impact (treatment vs. control tenants).
---

# Paywall Rollout Skill

This skill covers the Lite variant only. Full and Diagramly have no in-app restrictions.

## ⚠️ Block retired 2026-09 — most of this doc is now historical

`shouldBlockActions` in `useCustomerSuccessService.ts` is hardcoded `false`: editing is **never
blocked** at any macro count, on any space. `PaywallGate`/`UpgradePrompt` no longer mount, and
`paywall_triggered`, `paywall_blocked_edit`, and `paywall_blocked_create` **stop firing entirely**
going forward — do not read a drop in those events as tenants falling under the limit. The
non-blocking `PaywallWarningBanner` (`paywall_banner_shown`/`paywall_banner_dismissed`,
`extension_request_clicked`, `paywall_bundle_cta_clicked`) is the only surviving in-app signal.
Everything below this notice that reasons about block/trigger events, Continue-attempts, or
Group A/B block-rate comparisons describes the retired behavior — treat it as historical unless a
future Plan-and-usage/Request-Full redesign reinstates a gate. CSS/`PAYWALL_EXEMPT` enrollment
state (Steps 1–5) is unaffected and still governs whether the warning banner is eligible to show.

## Default-on semantics (2026-08-07, lite-paywall-default-on)

The Lite paywall is now **on by default for every Lite tenant**. `CUSTOMER_SUCCESS_SERVICE`
(CSS, Step 1 below) is **no longer the live paywall gate** — it is only the daily
macro-count snapshot enrollment list. The runtime gate is a separate KV value,
`PAYWALL_EXEMPTIONS`, in the same `KV_FEATURE_FLAGS` namespace:

- absent from `PAYWALL_EXEMPTIONS` → tenant gets the default-on paywall (warn 85 / block 100);
- an exact domain key set to `true` → that tenant is exempt (unrestricted);
- `"*": true` → fleet-wide kill switch, every tenant is exempt;
- `false` values are the same as absent — not exempt;
- read/write with `python3 .claude/skills/paywall/scripts/paywall_exemptions.py get|put '<json>'`
  (same namespace as `css_flag.py`, key `PAYWALL_EXEMPTIONS`, boolean-only values enforced
  before any write reaches KV).

Do not read `-x-` soft-disabled CSS keys (Step 1's convention below) as the live
disable mechanism anymore — that convention now only affects snapshot enrollment. A
tenant's real paywall state comes from `PAYWALL_EXEMPTIONS`, not CSS. See
`docs/superpowers/specs/2026-08-04-lite-paywall-default-on-design.md` for the full
design and rollout gates.

## Default Behaviour (no arguments)

When invoked with no description or extra prompt, run **both** the daily monitoring and A/B impact analysis automatically:

1. Read the current CSS flag (Step 1) — CSS is the snapshot-enrollment list, kept for the tenant-data gathering steps below; it is NOT the live paywall gate (see **Default-on semantics** above — that's `PAYWALL_EXEMPTIONS`)
2. Run the parallel Mixpanel queries for the last 1 day (Step 2 below) — Q1–Q4 in parallel, then Q5 for domains with blocks or high save volume
3. Build the domain table and suggest next steps
4. Run the **A/B Impact Analysis** section — measures paywall friction against control tenants
5. Send a PushNotification with the combined summary (daily highlights + A/B deltas)
6. Run the self-review (Step 6 below) — surface errors, surprises, and proposed skill improvements

When debugging a specific tenant (version drift, missing paywall, odd events), use **Troubleshooting** below — not part of the numbered daily run.


---

## Rollout States

Every Lite tenant sits in one of three states. Your job is to determine which state each tenant is in and recommend the next action. The "gate" column is `PAYWALL_EXEMPTIONS` (see **Default-on semantics** above), not CSS — CSS only decides snapshot enrollment.

| State | Gate (`PAYWALL_EXEMPTIONS`) | What user sees |
|-------|-----|----------------|
| **Unrestricted (exempt)** | domain or `"*"` set to `true` | No paywall at all |
| **Paywall on (default)** | absent or `false` | Warning at 85 macros (per space), blocked at 100 macros (per space). `UpgradePrompt` when an edit is blocked. The user gets **3 "continue editing" attempts per user+space** (15 before 2026-08-16) before the modal hard-blocks (continue button disappears, replaced by "Request extension to continue editing") — see **Continue-attempts gate** below. |
| **Licensed** | any | Space paid via KV license — restrictions bypassed entirely |

## Continue-attempts gate (added 2026-06-02, `v2026.06.02-lite`)

Once a space is over the limit, the `UpgradePrompt` no longer offers unlimited "Continue editing without upgrading". Each user gets **3 attempts per (clientDomain, spaceKey, userAccountId)**, tracked client-side (`DEFAULT_CONTINUE_ATTEMPTS`, lowered from 15 on 2026-08-16). The new value applies to new (user, space) pairs only — a stored balance is never rewritten, so users who started under the old default still hold up to 15.

- **Mechanism:** `src/utils/paywall/continueAttempts.ts`. State lives in **localStorage** under key `paywallContinueAttempts:<clientDomain>:<spaceKey>:<userAccountId>` (parts URL-encoded), shape `{ remainingAttempts, firstTriggeredAt, lastUsedAt, exhaustedAt }`. Default `DEFAULT_CONTINUE_ATTEMPTS = 3` (15 before 2026-08-16). Created at paywall mount (`getOrCreateContinueAttempts`), decremented per continue click (`useContinueAttempt`). **Lite-only** — gated on `isLite`, so full/diagramly never trigger it. localStorage lives in the **Forge iframe origin** (`*.cdn.prod.atlassian-dev.net`), not the top-level page.
- **UI:** continue button reads `Continue editing without upgrading (N)`; at `N=0` it's replaced by the `continue-attempts-exhausted` span ("Request extension to continue editing"). The advocacy/request-extension CTAs remain.
- **New events** (register/query alongside the existing paywall events):
  - `paywall_continue_used` — every continue click while attempts are tracked. Props: `remaining_attempts_before`, `remaining_attempts_after`, `storage_source: 'local_storage'`, `action_type`, plus upgrade context. **This is the decrement event.**
  - `paywall_attempts_exhausted` — fires when the click takes the count to 0.
  - `paywall_continued_editing` (existing) now also carries `remaining_attempts_before/after` when attempts are tracked.
- **Analytics caveat:** `remaining_attempts_after` is **UI-predicted** (`attemptsBefore − 1` computed in `UpgradePrompt`), not a read-back of the persisted counter (which `PaywallGate`/`useContinueAttempt` writes). Under rapid re-fire (double-click, laggy iframe, automation retries) the event **overcounts decrements** and `after` may not equal the stored value. Normal sequential clicking records correctly. Don't treat a raw `paywall_continue_used` count as the true number of decrements without sanity-checking `remaining_attempts_before` distribution.
- **Board report:** "Continue attempts used — daily by customer (excl. internal)" on the **Paywall** board (dashboard `11179489`) tracks real-tenant usage.

## Known Internal Sites

These CSS-enrolled domains are ZenUML's own Confluence instances — not customer tenants. Mark as `internal` in all tables; never count their engagement metrics toward customer enrollment recommendations.

- `zenuml` → zenuml.atlassian.net (production/internal)
- `zenuml-connect` → zenuml-connect.atlassian.net (internal, Connect-era)
- `zenuml-stg` → zenuml-stg.atlassian.net (staging)
- `lite-stg` → lite-stg.atlassian.net (staging)

## Interpretation lens

Numbers don't speak for themselves. Before flagging any anomaly — zero paywall events, edit collapse, friction-rate spike, sudden new domain on the list — pause and consider whether one of these confounds explains it:

- **Regional holiday** in the tenant's primary engineering geography. Signature: views drop partially, edits collapse. Common pattern, easy to miss.
- **Rollout shock** if the tenant was CSS-enrolled within the last 7 days. Their friction will be inflated until users adapt.
- **Data settling** for the most recent day — late events trickle in for ~24h.
- **Sub-threshold trigger** if `paywall_triggered` fires for a space `metrics-inspect` shows under 100 macros — suspect a count-source mismatch, not a paywall regression.

When you hit a suspicious anomaly, consult `private/paywall/interpretation.md` — it has the tenant geography table, holiday calendar, and a Golden Week worked example. Read it on demand rather than carrying it through every run.

---

## Step 1: Read current flag state

Run from the `conf-app` project root:

```bash
python3 .claude/skills/paywall/scripts/css_flag.py get
```

Output is a JSON object — `{"zenuml-stg":true,"tenant-a":true,...}` — keys are subdomain prefixes. The script bakes in `--remote` and the namespace ID, so the common local-Miniflare and stderr-redirection footguns can't be hit; read the script header for details if you need them.

> **`-x-` keys are DISABLED tenants, not customers or bugs.** To turn the paywall **off** for an enrolled tenant without losing the record (e.g. they started a Full trial or converted), we **mangle the key by inserting `-x-`** so it no longer matches the live client domain — e.g. `acmecorp` → `acme-x-corp`. The backend matches CSS by exact string equality (`functions/feature-flags.ts`), so the mangled key resolves to "not enrolled" → the paywall short-circuits for that tenant. The entry stays `true` but matches nothing. A `-x-` key is a *soft-disabled* tenant: it is NOT a real customer domain, must NOT be counted as enrolled, and must NOT be queried in the monitoring/per-space steps. To re-enable, remove the `-x-`; to clean up permanently, delete the key (see **Disable a tenant on CSS** in Step 5).

**Authentication:** the wrapper relies on `npx wrangler` being authenticated. If you get `401 Unauthorized`, run `npx wrangler login` in an interactive terminal or export `CLOUDFLARE_API_TOKEN` with Workers KV read (and write if updating CSS). Until auth works, skip the "on CSS?" column and state clearly that the CSS list was unavailable — do not infer enrollment from Mixpanel alone.

## Infrastructure constants

| Resource | Value |
|----------|-------|
| CSS flag KV namespace (`KV_FEATURE_FLAGS` — CSS flag only, NOT space licenses) | `fe9042cb20994651b0a2ef9e68f9037c` |
| `PAYWALL_EXEMPTIONS` KV key (same namespace, production only — see **Default-on semantics** above) | `python3 .claude/skills/paywall/scripts/paywall_exemptions.py get\|put '<json>'` |
| D1 production DB | `conf-zenuml-prod` |
| metrics-inspect URL | `https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<domain>&addonKey=com.zenuml.confluence-addon-lite` |
| Mixpanel project ID | `3373228` (full reference: the **mixpanel** skill) |
| Marketplace license report | `https://marketplace.atlassian.com/manage/vendors/1215266/reporting/licenses` (vendor login required — see **Conversion check**) |

> **D1 note:** There are several D1 databases in the account. Only `conf-zenuml-prod` has production data (2.2 GB). `conf-zenuml-dev` and others are empty or staging-only.

---

## Step 2: Daily Monitoring Queries

Prefer `scripts/paywall_queries.py` over hand-built Mixpanel payloads. It centralises the segmentation query for every event in this skill so a filter-shape mistake can't silently substitute a global aggregate. It pulls the API secret from `.env.mixpanel` and prints `{event: {breakdown: count}}` as JSON.

> **CORRUPTION GUARD — empty `__unique` maps mean the WHOLE run is bad.** Observed 2026-06-03, 2026-06-04, 2026-06-10: `daily` returned `{}` for every `__unique` key while totals were silently undercounted 10–30× (e.g. `example-tenant-a` triggered 3 vs actual 91 — real name: see private/ client profiles). Root cause (found 2026-06-10): `date_range()` used local-time `dt.date.today()` — in an AEST morning that date hasn't started in the Mixpanel project timezone, so the script queried a near-future day. Fixed in the script (project-tz-safe window), but keep the tripwire: **if any `__unique` map comes back empty, discard ALL script output from that run (`daily` AND `per-space-all`) and re-pull via MCP Insights.** `ab-metrics --window-days 7` usually only loses a leading sliver, but see the 2026-07-10 update to Guard #2 below — it is not immune either.
>
> **CORRUPTION GUARD #2 — `__unique` > total is impossible; the `__unique` map is the bad one (NOT the totals).** Observed 2026-06-22: `daily` totals were correct (paywall_triggered `example-tenant-a`=3, `example-tenant-b`=2, MCP-confirmed) but the `__unique` maps were **inflated** — reported `paywall_triggered__unique` `example-tenant-a`=17, `example-tenant-c`=6, `example-tenant-b`=5, etc. (32 "unique users" against 5 total events; real names: see private/ client profiles). The JQL `__unique` sub-query appears to span a wider-than-today window in this failure mode (opposite of guard #1, where totals undercount and uniques empty). **Tripwire: for any event, if a domain's `__unique` value exceeds its total, the whole `__unique` set is untrustworthy this run — keep the totals, but re-pull the unique counts via MCP Insights** (math:`unique`, breakdown `client_domain`, last 1 day, global `is_internal_client_domain = "false"` filter). Totals + per-space (which carry no unique) stay usable. **2026-07-10 update: this also hit `ab-metrics --window-days 7`** — 3 low-volume domains showed `macro_save_succeeded__unique` of 1-2 against a total of 0 (unique > total, same signature). Small magnitude (immaterial for high-volume tenants) but the earlier "has stayed reliable" claim for `ab-metrics` was too strong — apply the same tripwire to it, not just `daily`/`per-space-all`.
>
> **CORRUPTION GUARD #3 — a `client_domain` breakdown that comes back with EXACTLY 60 buckets is truncated, not complete.** Observed 2026-09-06: `daily --window-days 30` and `ab-metrics --window-days 30` both returned exactly 60 domains for `macro_save_succeeded` AND exactly 60 for `macro_viewed`. The same window via MCP Insights returned 209 / 245 / 467 / 77 buckets (saves / creates / views / triggered). Cause: `call_segmentation()` passes no `limit`, so Mixpanel's segmentation API returns only its default top-N segments by volume. Every domain outside the top 60 is silently ABSENT and reads as zero — a fleet-wide "which tenants are inactive" pass built on this output over-counted inactive tenants 79 → 35 (true value). **Tripwire: if any breakdown map has exactly 60 keys, treat every missing domain as UNKNOWN, not zero. Fleet-wide per-domain totals must come from MCP Insights (`Run-Query`, `breakdowns` on `client_domain`, one report can carry all four events) — it is not capped this way.** The per-domain `where` path (`per-space`, `per-space-all`) is not affected (a single tenant never has 60 spaces), but see the quota trap below before looping it over many domains.
>
> **QUOTA TRAP — the raw Query API has an hourly cap that a per-domain loop exhausts in minutes.** 2026-09-06: `per-space-all` over 123 domains (×4 events) plus a parallel 123-call `macro_viewed` loop hit HTTP 429 within ~10 min and stayed 429 past the top of the next UTC hour — the window is ROLLING (~60 min from the burst), not calendar-hour, despite what the script's error text says. Do not fan `call_event(where_domain=…)` out over more than a handful of domains; for fleet-wide questions use one Insights breakdown (Guard #3). The MCP path uses a different auth/quota bucket and kept working while the script was locked out.

```bash
# Q1 + Q3–Q4 in one call (paywall_triggered, advocacy_message_copied,
# macro_save_succeeded, macro_save_failed, paywall_continued_editing,
# macro_create_succeeded — all broken down by client_domain). Q2 was
# removed from the script 2026-05-12; see Q2 below.
#
# Returns BOTH event totals and unique-user counts. Unique-variant keys
# have a `__unique` suffix, e.g. `paywall_triggered__unique`. Use both:
# events answer "how much pressure", unique answers "how many people".
python3 .claude/skills/paywall/scripts/paywall_queries.py daily

# Q5 for ALL CSS customer domains in one batch — 4 JQL calls total instead
# of N×4 segmentation calls. Read CSS domains from Step 1, exclude internals.
# Output: {event: {domain: {space: count}}}
# Pass the live CSS list (subdomain prefixes); never hardcode tenant names here.
CSS_DOMAINS=$(python3 .claude/skills/paywall/scripts/css_flag.py get \
  | jq -r 'to_entries[] | select(.value==true) | .key' \
  | grep -vE '^(zenuml|zenuml-stg|zenuml-connect|lite-stg)$' \
  | grep -v -- '-x-')   # drop soft-disabled tenants (see -x- note in Step 1)
python3 .claude/skills/paywall/scripts/paywall_queries.py per-space-all \
  --domains $CSS_DOMAINS

# Q5 for a single domain (use only when debugging one tenant, not for daily run)
python3 .claude/skills/paywall/scripts/paywall_queries.py per-space <domain>

# Larger window (default is 1 day)
python3 .claude/skills/paywall/scripts/paywall_queries.py daily --window-days 7
```

The legacy MCP-based approach below is preserved for the cases where the script can't run (`.env.mixpanel` missing, no network, or you need a chart format the script doesn't produce). In those cases use `mcp__claude_ai_Mixpanel__Run-Query` with project_id=3373228, last 1 day, chartType=table, breakdown by `client_domain`, plus the mixpanel skill's global `is_internal_client_domain = "false"` filter. The query reference below documents each event's purpose — read those notes regardless of execution path, since they tell you what each metric *means*.

> **Server name matters (MCP fallback).** Use the `mcp__claude_ai_Mixpanel__` tool namespace consistently — the older, deprecated Mixpanel MCP server rejected the `report` parameter as a string in some sessions (`Input should be a valid dictionary`); the claude.ai namespace accepts the same payload reliably.

**Correct breakdown schema (MCP fallback)** (the schema evolves — if validation fails, call `Get-Query-Schema(report_type: 'insights')` first):
```json
"breakdowns": [{"metric": {"type": "property", "propertyName": "client_domain", "propertyType": "string", "resource": "event"}}]
```

**Filter shapes (MCP fallback, verified 2026-08-22):** string filters take a SINGLE value — no arrays (`{"type":"string","propertyName":"client_domain","operator":"equals","value":"<one-domain>"}`). For a customer-wide domain table, pair the breakdown with the mixpanel skill's global filter `{"type":"string","propertyName":"is_internal_client_domain","propertyType":"string","resource":"event","operator":"equals","value":"false"}`; do not list internal domains one by one. A specifically targeted customer query may instead use its `client_domain = "<one-domain>"` filter. For per-editor (champion-structure) breakdowns use `user_account_id` — breaking down by `distinct_id` returns a single `"undefined"` bucket.

The daily script runs these events in parallel internally.

**Q1 — Paywall block events**
```
event: paywall_triggered, measurement: total
```
> The legacy event name `upgrade_action_blocked` (pre-2026-04-29) is no longer emitted. Only query it if your window crosses 2026-04-28; for any window after 2026-04-29, `paywall_triggered` is the only block event.

**Q2 — Paywall display events (`upgrade_modal_shown`)**

Not included in `paywall_queries.py daily` as of 2026-05-12: it duplicated `paywall_triggered` ~1:1 in production, so the script dropped it to save API calls. For a one-off modal-impression series, use MCP/Insights: `upgrade_modal_shown`, breakdown `client_domain`. In the monitoring table, put `—` in **modal_shown** unless you ran that separate query.

**Q3 — Advocacy copy (sole in-modal intent signal)**
```
event: advocacy_message_copied, measurement: total
```
> The Lite paywall modal is advocacy-only: users copy a templated message to admins. **Intent capture** is Q3 (`advocacy_message_copied`) only.

**Q4 — Macro save activity** (edit-activity baseline)
```
event A: macro_save_succeeded, measurement: total
event B: macro_save_failed, measurement: total
event C: paywall_continued_editing, measurement: total
event D: macro_create_succeeded, measurement: total
```
> `saves` = `macro_save_succeeded` (edits of existing diagrams). `creates` = `macro_create_succeeded` (first-time saves of new diagrams). These feed `friction` and `continued` in the monitoring table — see definitions in **Build the monitoring table** below. Non-CSS domains with high save volume are CSS enrollment candidates; flag them in the report.

**Q5 — Per-space breakdown for domains with blocks, high save volume, or creates**

Run `per-space-all` once for all CSS customer domains — fans all N×4 segmentation API calls in a single parallel pool (one call per domain×event combination), far faster than looping `per-space` per domain. Read the CSS domain list from Step 1 output (exclude internals: zenuml, zenuml-stg, zenuml-connect, lite-stg).

```bash
python3 .claude/skills/paywall/scripts/paywall_queries.py per-space-all \
  --domains <domain1> <domain2> ...
```

Output: `{event: {domain: {space: count}}}`. From this output, focus only on domains where triggered > 0 OR saves > 10 OR creates > 0. Wall time ≈ the slowest single segmentation call rather than N×4 sequential batches.

Cross-reference space keys against metrics-inspect (`curl "https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<domain>&addonKey=com.zenuml.confluence-addon-lite"`) to get each space's macro count. **Always pass `addonKey=com.zenuml.confluence-addon-lite`** — omitting it reads the Full KV bucket, whose counts diverge badly from Lite (2026-05-28 postmortem in `private/paywall/runbook.md`; e.g. one heavy tenant's top space read 278 macros without the param vs 505 with the Lite bucket). This catches the pattern where a tenant has heavy spaces (>100 macros) but saves happen in light spaces — which explains zero blocks despite high activity. See `private/paywall/runbook.md` for the canonical case study (heavy-space-but-light-saves).

When `paywall_continued_editing` is high for a tenant, the per-space split tells you which space the bouncing user is on — the script already includes that event. See `private/paywall/runbook.md` for a worked case where this concentrates in a single user/space pair.

**MCP fallback for Q5.** If you cannot run the script, build the equivalent Insights query manually: metrics `paywall_triggered`, `macro_save_succeeded`, `macro_create_succeeded`, `paywall_continued_editing`, each with `filters: [{propertyName: "client_domain", operator: "equals", value: "<domain>"}]` — note `filters` is a plural array, not `filter: {...}`. Breakdown by `confluence_space`. Sanity check: every space key in the result should plausibly belong to the target tenant; a foreign key means the filter was ignored.

### Build the monitoring table

**Output format: always render as a markdown table — never as a bullet list or prose.** One row per customer CSS domain (exclude internal sites). The table must appear verbatim in your response under the heading "Step 2: Daily Monitoring Table (last 24h, ending now)".

> **Window semantics (corrected 2026-05-18):** `paywall_queries.py daily --window-days 1` returns events for **today only** (partial day rolling up to the moment the query runs — typically 6-18h of data). Mixpanel ingestion lag is ~5-10 min so today's numbers are fresh enough to monitor "as of now". Earlier behaviour was yesterday-only, which created a 24h blind spot — fixed in `date_range()`. Partial-day numbers will be lower than full-day totals; don't compare a 14:00-run snapshot to a previous-day total without scaling.

For customer domains on CSS: **read the live CSS flag from Step 1** to get the current list. Do not rely on any hardcoded list here — it goes stale as new tenants are enrolled. Exclude internal sites: zenuml, zenuml-stg, zenuml-connect, lite-stg.

| Domain | triggered (events / users) | advocacy (events / users) | intent_capture_rate | saves (events / users) | creates | friction | continued (events / users) | note |
|--------|-----------------------------|----------------------------|---------------------|-------------------------|---------|----------|-----------------------------|------|

- `triggered` = `paywall_triggered` total / `paywall_triggered__unique`. Show both as `events / users` (e.g. `13 / 10`). Render the unique-user count as the primary outreach signal — it tells you whether the friction is **broad-base** (many users) or **concentrated** (one frustrated power user).
- `advocacy` = `advocacy_message_copied` total / `advocacy_message_copied__unique`. The user count is the de-duplicated advocate count; the event count tells you how motivated each one was (multiple copies = sending to multiple recipients).
- `intent_capture_rate` = `advocacy_copies / triggered` (events). **Can exceed 100%** — a single user may copy multiple times. This is the strongest intent signal possible, not a data error.
- `saves` = `macro_save_succeeded` total / `macro_save_succeeded__unique` (edits of existing diagrams).
- `creates` = `macro_create_succeeded` (events only — unique not currently fetched for creates).
- `friction` = triggered_events / (triggered_events + saves_events). Add as a note if > 50%.
- `continued` = `paywall_continued_editing` total / `paywall_continued_editing__unique`. High events but low users → one user repeatedly bouncing; high on both → broad cohort affected.
- `note` — flag the **kind** of friction in plain English: `broad-base` (many users, few events each) vs `concentrated` (few users, many events each). Also flag high `intent_capture_rate`, zero advocacy with high triggers, or domains in Q1/Q4 but not on CSS (anomaly / enrollment candidate).
- Lead the PushNotification summary with **breadth × intent**: highest-priority is a tenant with both many unique trigger users AND advocacy copies (org-wide pain + motivated advocate). Concentrated power-user friction is lower priority — fix one person's blocker rather than reach the buyer.
- Flag any domain that appears in Q1 or Q4 results but is NOT in the CSS list — that's an anomaly or CSS enrollment candidate

> **Before flagging anything as anomalous, run the Interpretation lens** (top of this skill). For tenant-specific geographies and the holiday-vs-paywall-regression worked example, read `private/paywall/interpretation.md` — only load it when you actually have an anomaly to interpret, not on every run.

### Per-space sub-table (for domains with blocks, saves > 10, or creates > 0)

| Domain | Space | macros | triggered | saves | creates | note |
|--------|-------|--------|-----------|-------|---------|------|

- `macros` = total from metrics-inspect for that space
- Highlight spaces where macros ≥ 100 and triggered = 0 — these are latent paywall spaces where users edit but haven't hit a blocked user yet (or are view-only)
- Highlight spaces where macros ≥ 100 and triggered > 0 — active paywall spaces
- **Creates are gated as of 2026-05-15** (PR #89, `paywall_blocked_create` event). Before that date, creates bypassed the paywall; in any window crossing 2026-05-15, expect `paywall_triggered` for creates to ramp in. Spaces where `creates > 0` and `triggered > 0` are no longer "self-ratcheting" — both edits and creates are now blocked when the space is over the limit. Strategy details: `docs/paywall-strategy.md`.

### Continued-rate by surface (added 2026-05-18)

Project-wide table breaking down `paywall_continued_editing / paywall_triggered` by `action_type`. Each surface has a different psychological cost — the user wants to know which surfaces the user "powers through" vs which they actually bounce off.

| Surface (`action_type`) | triggered | continued | continued_rate | meaning |
|---|---:|---:|---:|---|
| `page_editor` (edit existing) | … | … | … | edit attempts past 100-macro limit |
| `page_editor_create` (new macro) | … | … | … | new-create attempts past limit |
| `fullscreen_viewer` (read-only) | … | … | … | fullscreen view of a saturated space |

> **Data availability:** `action_type` was added to `paywall_continued_editing` (and `upgrade_modal_shown` / `upgrade_modal_dismissed` / `advocacy_message_copied`) on 2026-05-18. **For windows before that date, the breakdown shows 0% across all surfaces** — the property doesn't exist on historical events. From 2026-05-18 onward, every production-path event populates `action_type` (via `mountUnderPaywallGate`). If `fullscreen_viewer` continued_rate is materially lower than `page_editor`, that's expected — there's nothing to "continue editing" in a read-only viewer; users either dismiss the modal to keep looking or close the viewer entirely.
>
> **Note on `trigger_source` (legacy):** The `upgrade_modal_shown` event continues to emit `trigger_source: 'header_badge'` alongside the new `action_type` to keep saved Mixpanel queries and the existing unit test working. Prefer `action_type` for any new analysis; treat `trigger_source` as deprecated and remove once saved queries have migrated.

Query (insights, last 1 day):
- metric A: `paywall_triggered` total, breakdown by `action_type`
- metric B: `paywall_continued_editing` total, breakdown by `action_type`
- compute B/A per row

### Non-CSS domains in the results

If a domain appears in Q1/Q2/Q3/Q4 results but is **not** in the CSS flag, check `private/paywall/anomalies.md` before treating it as a new finding. The reference file lists known persistent anomalies with first-seen dates. If the domain is new, add a row to that file — don't re-investigate every day. Genuinely new + persistent (3+ days) anomalies are worth a code-path investigation, since they suggest the CSS flag check is being bypassed.

### PushNotification

After building the table, send a PushNotification (single `message` field only — no separate title/body):
- Format: `Paywall Daily {date} | {intent highlights} | {summary}`
- Keep under 200 chars total
- Lead with advocacy/intent stats (e.g. domains with the highest `advocacy_copies` or `intent_capture_rate`), not legacy “marketplace vs enterprise” CTA counts

---

## Step 3: Gather tenant data for CSS enrollment decisions (run in parallel)

> **When to run:** Step 3 is for deciding whether to enroll a non-CSS tenant into CSS (turning the paywall on for them), not daily monitoring. The default flow (no arguments) can skip Steps 3–5 unless the monitoring table shows non-CSS domains with high save volume or near-100-macro spaces. Run Steps 3–5 when: the user asks "who should we enroll in CSS?" or when Step 2 reveals new tenants with sufficient activity.

For each candidate domain, run these **in parallel**:

```bash
# 1. Macro counts + space data per domain
curl -s "https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<domain>&addonKey=com.zenuml.confluence-addon-lite"

# 2. Install age — ClientInstallation uses subdomain prefix (no .atlassian.net)
npx wrangler d1 execute conf-zenuml-prod --remote --command "
SELECT clientDomain, MIN(timestamp) as first_install
FROM ClientInstallation
WHERE clientDomain IN ('zenuml-stg','tenant-a','tenant-b','zenuml-connect','zenuml')
GROUP BY clientDomain"

# 3. Recent Confluence activity — UserBehaviorEvent uses FULL hostname (with .atlassian.net)
# Use this only to confirm a tenant is active on Confluence, not for macro engagement
npx wrangler d1 execute conf-zenuml-prod --remote --command "
SELECT clientDomain, action, COUNT(*) as count
FROM UserBehaviorEvent
WHERE clientDomain IN ('tenant-a.atlassian.net','tenant-b.atlassian.net')
AND createdAt >= date('now', '-30 days')
GROUP BY clientDomain, action"

# 4. Recent macro activity — Mixpanel only (run per domain, parallelise)
# mcp__claude_ai_Mixpanel__Run-Query: event=macro_viewed, filter client_domain equals <domain>,
# measurement unique users, last 30 days, chartType=table
# DO NOT use D1 UserBehaviorEvent/DailyBehaviorCounter — those track all Confluence page views, not macro views
```

> **CRITICAL — D1 clientDomain format mismatch:**
> - `ClientInstallation` stores **subdomain prefix** (e.g. `tenant-a`)
> - `UserBehaviorEvent` and `DailyBehaviorCounter` store **full hostname** (e.g. `tenant-a.atlassian.net`)
>
> Always use full hostname when querying `UserBehaviorEvent`/`DailyBehaviorCounter`. Using the subdomain prefix silently returns 0 rows — no error, just wrong data. When in doubt, verify with `LIKE '%<partial-domain>%'` first.

The metrics-inspect response structure is `d['spaces'][spaceKey]['data']['total']` — NOT `d['data']['total']`. Parse with:
```python
spaces = d.get('spaces', {})
rows = [(k, v.get('data', {}).get('total', 0)) for k, v in spaces.items() if v.get('data')]
total = sum(r[1] for r in rows)
```
Use `total` as the primary activity proxy when viewer counts are sparse.

Build an enrollment recommendation table with these columns:

| Column | Source | Meaning |
|--------|--------|---------|
| `domain` | candidate list | Subdomain prefix |
| `on_css` | KV | Already enrolled? |
| `install_age_d` | D1 ClientInstallation.timestamp | Days since first install |
| `top_space_macros` | metrics-inspect | Largest single-space macro count (paywall surface area) |
| `spaces_over_100` | metrics-inspect | Count of spaces ≥ 100 macros |
| `viewers_30d` | Mixpanel `macro_viewed` (unique) | Unique macro viewers, last 30d |
| `saves_7d` | Mixpanel `macro_save_succeeded` | Total saves, last 7d |
| `recommendation` | computed | see Step 4 |

## Step 4: Interpret the table

The paywall is per-space (fires when any single space ≥ 100 macros). So enrollment only matters for tenants with a real chance of crossing that threshold.

### Guiding principle — lead with deeply-adopted tenants

Enrollment should surface the upgrade path to the teams for whom it is genuinely relevant: those who rely on ZenUML heavily and reach the free-tier limits in the normal course of their work. Prioritise depth of adoption; de-prioritise lightly-engaged tenants.

- **Relevance to the customer.** For a deeply-adopted team the paid tier is a natural fit, and the upgrade prompt is useful information at the moment they need it. For a lightly-engaged tenant the same prompt is mostly an interruption with little benefit to them — and a lightly-engaged team is more likely to remove the app than to act on it. Leading with engaged teams respects both sides.
- **Signal quality.** Heavily-adopted tenants give a clean read on whether the limits and upgrade path are landing well; marginal tenants mostly add noise to the A/B and monitoring.
- **Goal.** Maximise *relevant* reach (engaged teams that benefit from upgrading), not raw count of enrolled tenants.

- `enroll` — at least 1 space ≥ 100 macros (or top space ≥ 85 and trending up), install ≥ 14d, viewers_30d ≥ 3, saves_7d ≥ 5, **and genuine depth of adoption (see ranking below)**. Enroll in CSS.
- `monitor` — top space 50–99 macros, active editors. Re-check in a few weeks; not worth enrolling yet.
- `skip` — top space < 50 macros OR viewers_30d < 3. Zero paywall surface area; enrolling would be invisible noise.
- `already_enrolled` — already on CSS. Use the daily monitoring table to track friction.
- `internal` — ZenUML's own site; skip enrollment decisions.

**Rank `enroll` candidates by depth of adoption, not by recent edit volume alone.** The strongest single proxy is sustained engagement — `macro_viewed` over a long window (60–90d), which shows the diagrams are woven into day-to-day work — read together with total macros and the number of spaces over the limit. Prefer a tenant with one deep space (hundreds of macros, thousands of views) over one with the same headline macro count spread thinly across many small spaces, where few spaces ever cross the limit. Two refinements:

- **Sustained engagement over edit bursts.** A spike of recent saves can be a one-off; weeks of steady views show real, ongoing reliance — a better fit for the paid tier.
- **Weight very small teams cautiously.** A tiny team can show high per-user macro density, but a single admin's decision swings the whole account, so it is a less stable enrollment than a large, broadly-adopted tenant. This is a caution, not an exclusion.

(`top_space_macros` descending is still a reasonable tiebreaker once the above filters are applied — it surfaces the spaces most likely to reach the limit soonest.)

## Step 5: Execute changes

### Add domains to CSS

CSS is JSON — read, parse, add key, write back through `scripts/css_flag.py`:

```bash
python3 .claude/skills/paywall/scripts/css_flag.py get
# → {"zenuml-stg":true,"tenant-a":true,...}

python3 .claude/skills/paywall/scripts/css_flag.py put \
  '{"zenuml-stg":true,"tenant-a":true,"newdomain":true}'
```

The wrapper validates that the payload is a JSON object before writing — guards against a malformed CSS flag silently breaking the paywall for everyone.

### Disable a tenant on CSS (soft-disable `-x-` convention)

When an enrolled tenant should no longer see the paywall — e.g. they started a **Full trial/evaluation** or converted to a paid plan — **don't delete the key outright**; mangle it by inserting `-x-` so it stops matching the live client domain while preserving the record that they were once enrolled (placeholder `acmecorp` below — never put a real tenant name in this public file):

```bash
# disable: acmecorp -> acme-x-corp (paywall short-circuits; record kept)
CURRENT=$(python3 .claude/skills/paywall/scripts/css_flag.py get)
NEW=$(echo "$CURRENT" | jq -c '. + {"acme-x-corp": .acmecorp} | del(.acmecorp)')
python3 .claude/skills/paywall/scripts/css_flag.py put "$NEW"
```

To **re-enable**, reverse it (remove the `-x-`). To **clean up permanently** (e.g. the trial converted and the disabled entry is dead weight), delete the key — always read→`jq del`→write so a concurrent edit isn't clobbered:

```bash
CURRENT=$(python3 .claude/skills/paywall/scripts/css_flag.py get)
NEW=$(echo "$CURRENT" | jq -c 'del(."acme-x-corp")')
python3 .claude/skills/paywall/scripts/css_flag.py put "$NEW"
```

> A `-x-` key matches no live domain (it reads 0 macros in metrics-inspect), so disable vs. delete are functionally identical for the paywall — the difference is whether you keep the record. A soft-disabled tenant whose trial lapses back to Lite is re-enabled by removing the `-x-` (re-adding the real key). For tenant-specific disable/delete history (real names), see `private/paywall/runbook.md` and the team's memory — not this file.

### Activate a space license

For a tenant that paid via Enterprise Bundle, activate their space license:

```bash
curl -X POST https://conf-lite.zenuml.com/api/space-license \
  -H "Authorization: Bearer $ADMIN_API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"cloudId":"<cloudId>","spaceKey":"<spaceKey>","activatedBy":"<email>","paymentReference":"<stripe_id>","expiresAt":"<ISO8601>"}'
```

## A/B Impact Analysis (paywall vs control)

Periodic comparison: are paywall-affected tenants editing less than comparable unrestricted tenants? Run this weekly (Mondays, after the daily monitoring) so you have a rolling readout on real-world paywall friction.

### Group definitions

**Group A (treatment — paywall on).** CSS-enrolled tenants with ≥1 space ≥100 macros and a working baseline of edits in the last 7d. Refresh as enrollments change. Skip any tenant currently in a regional holiday (see `private/paywall/interpretation.md`) and skip newly enrolled tenants for 7 days post-enrollment (rollout shock dominates early days).

**Group B (control — paywall off).** Comparable tenants NOT on CSS, with ≥1 space ≥100 macros AND save volume of the same order as Group A. The macro-count requirement matters: a control tenant with no spaces over the threshold would never trigger the paywall even if enrolled — there's nothing to compare.

> **Current Group A and Group B cohort tables (with per-tenant rationale, excluded controls, and low-volume exemptions) live in `private/paywall/runbook.md`.** Refresh that file when enrollments or volume bands change — no edits to this SKILL.md needed.

### Step A1: Run the comparison queries

Use the `ab-metrics` script command — it runs all five metrics (saves total, triggers total, views total, save_users unique, view_users unique) in one invocation using 6 parallel API calls (segmentation + JQL), replacing the two slow MCP queries that were used previously.

```bash
python3 .claude/skills/paywall/scripts/paywall_queries.py ab-metrics --window-days 7
```

Output keys: `macro_save_succeeded` (saves), `paywall_triggered` (triggered), `macro_viewed` (views), `macro_save_succeeded__unique` (save_users), `macro_viewed__unique` (view_users) — all broken down by `client_domain`. Pull Group A and Group B domains from the output; ignore all others.

**MCP fallback** (if script unavailable): run two MCP queries with top-level `breakdowns: [{"metric": {"type": "property", "propertyName": "client_domain", ...}}]` — note `breakdowns` must be a top-level key on the report object, not nested inside each metric. Pull all domains and filter to A/B groups manually.

### Step A2: Build the comparison table

| Group | Domain | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|--------|-------|-----------|----------|------------|------------|-------|--------------|------------|

Definitions:
- `attempts = saves + triggered`
- `success_rate = saves / attempts` (%)
- `saves/user = saves / save_users`
- Aggregate per group by summing each numeric column.

### Step A3: Interpret

**Primary signal — `success_rate`.** Group B should sit at ~99% (no paywall, saves nearly always succeed). Group A's deviation from that is the cleanest measure of paywall friction in production.

| Group A success_rate | What it means |
|----------------------|---------------|
| > 80% | Paywall barely engaging — most users below threshold or not editing |
| 50–80% | Healthy friction — paywall firing as designed |
| 35–50% | Heavy friction — many users hitting the wall repeatedly |
| < 35% | Severe friction — investigate (broken upgrade path? unfair routing?) |

**Secondary signals:**
- `saves/user` lower in Group A → paywall reduces per-editor productivity. A >25% gap is meaningful.
- `view_users` per tenant in Group A is naturally higher (selection bias — larger tenants), so view-to-edit conversion ratios are noisy. Don't over-read them.

**Known confounds:**
- **Selection bias:** Group A tenants were enrolled because they were larger/more active. They have proportionally more passive viewers than Group B, which inflates `view_users` and depresses conversion ratios independently of the paywall.
- **Regional holidays:** Always check Group A tenants against `private/paywall/interpretation.md`. A tenant in JP Golden Week or SG Labour Day can drop edits to zero — that's not a paywall effect.
- **Newly enrolled tenants:** Hold for 7 days. Day 1 looks dramatic but isn't a steady-state read.

### Baseline snapshots

Snapshots from prior A/B runs live in `private/paywall/baseline.md` (most recent at top). After each weekly A/B run:

1. Read the most recent snapshot to compute Δ versus today.
2. Prepend today's snapshot to that file (don't overwrite — the longitudinal record is the point).
3. Quote week-over-week deltas in the daily report.

---

## Conversion check (both payment rails)

Paywall conversion has **two rails**, each with its own source of truth. Check both before claiming a conversion number — KV alone only covers rail 2.

| Rail | Buyer path | Source of truth |
|------|-----------|-----------------|
| 1. Marketplace plan | admin switches tenant Lite → paid Full SKU (per-user billing via Atlassian) | Marketplace license report: `https://marketplace.atlassian.com/manage/vendors/1215266/reporting/licenses` |
| 2. Enterprise Bundle | direct Stripe payment ($299/space/yr, no admin needed), manual KV activation | KV `license:*` keys in **SPACE_LICENSE_KV**, prod namespace `8969e8528105403bb2d9adca9fc16567` (`npx wrangler kv key list --namespace-id 8969e8528105403bb2d9adca9fc16567 --remote`) — **not** the CSS/feature-flags namespace `fe9042cb…`, which never holds `license:*` keys |

> **Rail 2 caveats.** (a) The canonical home of the SPACE_LICENSE_KV namespace id is `.claude/skills/extend-space-license/SKILL.md` — read it there rather than trusting a copy. (b) A raw `license:*` key count **over-counts conversions**: test grants and temporary editing extensions (granted via the extend-space-license skill) live in the same namespace. `kv key get` each record and filter by its `status` / `activatedBy` fields before counting a key as a paid conversion.

**Rail 1 — Marketplace report.** The page needs a vendor-account login, so use the user's browser session (claude-in-chrome works — it's a normal page, no Forge iframe). Don't scrape the UI table; hit the same-origin REST API from the page context and **aggregate in-page** (the extension's DLP filter blocks raw response bodies as credential-like data):

```js
// in page context on marketplace.atlassian.com (vendor 1215266)
fetch('/rest/2/vendors/1215266/reporting/licenses?limit=200&dateType=start&startDate=<YYYY-MM-DD>&endDate=<YYYY-MM-DD>&addon=com.zenuml.confluence-addon',
  {credentials:'include', headers:{accept:'application/json'}})
```

- Filter to the **paid app** (`addon=com.zenuml.confluence-addon`) — unfiltered windows are dominated by hundreds of Lite `FREE` rows.
- Conversion signal = `licenseType: COMMERCIAL` (purchase) and `EVALUATION` (trial — a leading indicator that an admin engaged at all). Ignore `FREE` / `LEGACY_FREE` (entitlement churn; the Forge migration re-dated many Lite FREE rows to 2026-04-27).
- Match `cloudSiteHostname` against the CSS tenant list to attribute a conversion to the paywall. Return hostnames with `.` escaped (e.g. `foo[.]atlassian[.]net`) or the DLP filter may redact them.
- Useful params: `dateType=start|end|update`, `offset` for pagination (50/page unfiltered), `order` is NOT a valid param (400).

**Baseline (2026-06-10, 6 weeks of paywall):** zero conversions from paywalled tenants on either rail — 0 COMMERCIAL/EVALUATION from the CSS cohort on rail 1 (only 2 unrelated 1-user organic licenses project-wide), 0 `license:*` keys on rail 2 (note: that count was read from the wrong namespace — the KV_FEATURE_FLAGS id — before the 2026-07-05 fix above; re-derive from SPACE_LICENSE_KV with the status/activatedBy filter before reusing it), 0 service-desk extension tickets despite 44 in-product extension clicks. The funnel dies before reaching anyone with budget; track this check weekly alongside the A/B run.

---

## Troubleshooting

Use this section when investigating a specific tenant or unexpected paywall behaviour. It is **not** part of the numbered Steps 1–6 daily run.

### Check Forge app version

When investigating why a tenant is or isn't seeing the paywall — or why their events look different from peers — start by checking which Forge app version they're on:

```bash
# From the conf-app project root
pnpm forge install list 2>&1 | grep -E "<domain1>|<domain2>"
```

Output columns: `Installation ID | Environment | Site | Atlassian apps | App version | Status`. Same `App version` + `Status: Up-to-date` across tenants means they're all on the same Forge code: minor-version code updates auto-distribute to all installations on the matching major (per [Forge minor versions](https://developer.atlassian.com/platform/forge/versions) — no admin consent required). So when events look inconsistent across tenants on the same major version, **first check the deploy timeline** (see Note below): the inconsistency is usually a date-based event-rename cutover, not per-tenant version drift. Browser bundle caching can briefly delay an updated JS for a single user's session but does not explain tenant-level patterns.

If a tenant shows `Status: Out-of-date`, that's a real version drift case — they need a Forge upgrade. This typically only happens when a major version bump (new permissions/scopes) is pending admin consent.

> **Note on event-name cutover (2026-04-28 → 2026-04-29):** The rename `upgrade_action_blocked` → `paywall_triggered` was merged to master via PR #1051 (commit 4d4d8cb2) on 2026-04-28, then auto-distributed by Forge as a minor-version code update (no major bump, no admin consent — see [Forge minor versions](https://developer.atlassian.com/platform/forge/versions)). Result is a clean date cutover: events emitted **on or before 2026-04-28 are stored as `upgrade_action_blocked`**, events **on or after 2026-04-29 use `paywall_triggered`**. Per-tenant differences in which name appears reflect *which days that tenant happened to have edit-block events*, not version drift (see `private/paywall/runbook.md` for observed examples). **Always query both event names for windows that span the cutover date**; for windows entirely after 2026-04-29, `paywall_triggered` alone is sufficient.

### Debugging a specific tenant

If a user reports they're not seeing the paywall, check in order:

1. **Forge app version** — run `pnpm forge install list 2>&1 | grep <domain>`. Interpretation, Out-of-date handling, and the event-name cutover are documented in **Check Forge app version** above.
2. **Is their domain on CSS?** If not, they'll never see the paywall regardless of macro count.
3. **Are they on Lite?** Paywall logic short-circuits to `false` for Full/Diagramly. Check Mixpanel `product_type` property on their `macro_viewed` events.
4. **Per-space macro count ≥ 100?** Paywall is per-space, not per-tenant. A tenant with 5,000 total macros across 100 spaces won't trigger if no single space crosses the threshold. Check `metrics-inspect` and look at top spaces by `total`.
5. **Are users actually trying to EDIT macros in over-threshold spaces?** Paywall fires on edit click (`paywall_triggered`), NOT on viewing. View-only users in a 1,000-macro space generate zero paywall events. Cross-check `macro_viewed` against `macro_save_succeeded` filtered by `client_domain` (and ideally `confluence_space`). **If edit activity collapses on a specific date while views only partially drop, suspect a regional holiday in the tenant's primary engineering geography** — see `private/paywall/interpretation.md` for the geography table and worked example.
6. **Is their space licensed?** Check KV: `license:{cloudId}:{spaceKey}`.
7. **Sub-threshold trigger discrepancy?** If `paywall_triggered` fires for a space that `metrics-inspect` shows below 100 macros, suspect a count methodology gap: `metrics-inspect` shows live macro counts, but the frontend paywall check in `useCustomerSuccessService.ts` may use a cached or differently-computed count. See `private/paywall/runbook.md` for observed cases. Reconcile by adding a debug log in `useCustomerSuccessService.ts` to emit the raw count seen at trigger time.

For local simulation, use localStorage overrides:
```js
localStorage.mockCSSEnabled = 'true'
localStorage.mockMacroCount = '105'
localStorage.mockSpacePaid = 'false'
```

### Paywall not showing on dev/staging during manual testing

This is a **different failure mode** from the tenant debugging above — it bites when you drive the paywall yourself on `lite-stg` / `lite-dev` and nothing appears. **The #1 cause is stale localStorage mocks left behind by a previous manual session** (or by the `?sandbox=` paywall presets, which auto-set them via `applyPaywallSandboxMocks` in `forgeGlobal.ts`). The mocks short-circuit the real CSS/count/license logic.

**Decision chain** (`useCustomerSuccessService.ts` `shouldBlockActions`), in order:
1. `spacePaidStatus === true` → **bypass everything** (early return, no block). Set by `mockSpacePaid` or `/api/space-status`.
2. else block iff `macrosCreated >= MACROS_LIMIT (100)` **AND** `customerSuccessServiceEnabled` **AND** `isLite`.

Paywall fires at **editor mount** (click `Edit` on a macro, or insert a new one), **not** in the viewer. Viewing a saturated page produces zero paywall.

**Read the console first — these logs tell you exactly what's overriding:**

| Console log | Meaning |
|---|---|
| `🧪 Using mock space paid status: true` | `mockSpacePaid=true` is forcing paid → paywall bypassed |
| `🧪 Using mock macro count: <N>` | `mockMacroCount` overriding real count (need ≥100 to block) |
| `🧪 Using mock CSS Feature Flag: <bool>` | `mockCSSEnabled` overriding CSS enrollment |
| `✅ Space is paid - bypassing all restrictions` | step 1 above fired — paywall will not show |
| `🚫 shouldBlockActions check: {...}` | the authoritative decision — read `macrosCreated`, `isLite`, `spacePaid`, `shouldBlock` |

**The five mock keys** (`useCustomerSuccessService.ts` + `forgeGlobal.ts`): `mockSpacePaid`, `mockMacroCount`, `mockCSSEnabled`, `mockSpaceKey`, `mockClientDomain` (plus `mockAiTitleEnabled` in `aiTitleFeatureFlag.ts`).

**CRITICAL — the mocks live in the Forge iframe's localStorage, not the top-level page.** The macro runs in a cross-origin iframe served from `*.cdn.prod.atlassian-dev.net`; the Confluence page is `*.atlassian.net`. Clearing `localStorage` on the top-level page does **nothing**. You must clear it inside the iframe's origin.

With Playwright, `frameLocator()` has **no** `.evaluate()` — grab the actual `Frame` object instead:

```js
// read / clear the mocks inside the Forge iframe origin
const forgeFrame = page.frames().find(f => f.url().includes('cdn.prod.atlassian-dev.net'));
await forgeFrame.evaluate(() => {
  Object.keys(localStorage)
    .filter(k => k.toLowerCase().includes('mock'))
    .forEach(k => localStorage.removeItem(k));
});
await page.reload();
// then click Edit on the macro and assert the modal:
//   h2 "This space has reached the ZenUML Lite limit (100 macros)."
//   [data-testid="continue-editing-btn"]  (or continue-attempts-exhausted at 0)
```

Confirm the real count is actually over threshold once mocks are gone: KV key `metrics:<domain>:<lite|full>` in namespace `9531a58d3f5b47a6af77750240c09548` (shared staging+prod), e.g. `npx wrangler kv key get "metrics:lite-stg:lite" --namespace-id 9531a58d3f5b47a6af77750240c09548 --remote`.

## Step 6: Self-Review (always run after monitoring)

After completing the monitoring run, review what happened and propose skill improvements. Do this every time — not just when something went wrong.

### What to check

1. **Errors or unexpected results** — did any query fail, return unexpectedly empty results, or require a workaround not covered in the skill? If so, document the fix.

2. **Event name drift** — did any event return 0 results that should have data? Could be a rename, a drop, or a new event name. Check with `mcp__claude_ai_Mixpanel__Get-Events` if suspicious. Note: `macro_save_failed` (Q4 event B in the macro-activity query) is expected to be very sparse or zero — this is normal, not a drift signal.

3. **Domain list staleness** — are there new domains in Q1/Q2 results that aren't in the known CSS list? Flag them — they may need to be enrolled.

4. **Internal site misclassification** — were any internal sites (zenuml, zenuml-connect, zenuml-stg) accidentally counted as customer tenants in the table?

5. **Query structure issues** — did the Mixpanel query schema require a workaround (e.g. breakdown not working inside metric, filter syntax)? Note the correct pattern.

6. **Missing coverage** — is there a signal the table doesn't capture that would be useful (e.g. `upgrade_modal_dismissed` rate, time-to-CTA)?

### Output format

End your run with a section like this:

```
## Skill Self-Review

**Ran cleanly:** yes / no

**Issues encountered:**
- [describe any error, empty result, or workaround needed]

**Proposed improvements to SKILL.md:**
- [specific wording or section changes — quote the line to change and the replacement]
```

Apply proposed improvements directly to the skill file without asking for confirmation.

---

## Reference: Source files

| What | File |
|------|------|
| Thresholds (85 warning / 100 block) + CSS flag fetch + space-paid check | `src/composables/useCustomerSuccessService.ts` |
| Single paywall modal | `src/components/UpgradePrompt/UpgradePrompt.vue` |
| Upgrade tracking event names | `src/utils/upgradeTracking.ts` |
| Space license endpoint | `functions/api/space-status.ts`, `functions/api/space-license.ts` |
| Pricing tiers + cost formula | `docs/pricing-model.yml` |
| Is a specific tenant already paying / on a trial? | `tenant` skill — `whois <domain>` (single-tenant lookup, incl. Lite Layer-B) |

## How the Lite paywall actually enforces (don't misread this as a bug)

It is a **metered soft-paywall, and the number in "Continue editing without upgrading (N)" IS the gate.**
`DEFAULT_CONTINUE_ATTEMPTS = 3` (15 before 2026-08-16; a stored balance is never rewritten); each click decrements N and lets the user reach the editor and
**save normally — saves persisting during the grace window is BY DESIGN, not a leak.** When N hits 0,
the Continue-editing button is replaced by non-clickable "Request extension to continue editing"
(`UpgradePrompt.vue`, `canContinueEditing = remainingContinueAttempts > 0`), and the modal can no
longer be dismissed into the editor → user is locked out.

So `saveToPlatform` deliberately has **no** `shouldBlockActions` check — access is gated at the modal
via the counter, not at the persistence layer. (The "save is gated in the persistence layer" code
comments are misleading wording; ignore them.)

The only real weakness: the counter is `localStorage`-keyed
(`paywallContinueAttempts:domain:space:user`), so clearing storage/incognito resets it to 3 (the default) — a minor
client-side soft spot, NOT a missing save-gate.

### Skipping the paywall on an over-limit Lite space

When the paywall modal appears at editor mount (e.g. inserting/editing a Lite macro on an over-limit
space like `ZEN` or `SD`), click the modal's **"Continue editing"** button to proceed into the editor.
This is the intended in-product bypass — do NOT read paywall code or hunt for `localStorage` overrides
(`mockSpacePaid` etc.) to suppress it.

**The modal DOM lives INSIDE the Forge iframe, not the top-level page.** Detecting it with
`page.evaluate(() => document.body.innerText)` on the Confluence page returns nothing and reads as
"no paywall" — that false negative cost a wrongly-abandoned spot check on 2026-07-25. Find the frame
first, then assert/click inside it:

```js
const host = page.frames().find(async f => /reached the ZenUML Lite limit/i.test(await f.evaluate(() => document.body?.innerText || '')));
await host.locator('[data-testid="continue-editing-btn"]').first().click();  // label: "Continue editing without upgrading (N)"
```

Two gotchas once you're through: the Graph editor is **two** nested frames (app chrome with
`Name your graph…` + the DrawIO canvas frame with `.geDiagramContainer` and Publish) — `page.frames()`
returns them flattened, so locate each by content rather than chaining `.contentFrame()`. And
`page.keyboard.type()` after a shape insert can land in the **title input** instead of the shape label,
which silently defeats any empty-title (AI auto-title) assertion — always re-read the title field
before publishing.

If `N = 0`, the counter is exhausted and the continue button is gone; reset it by deleting
`paywallContinueAttempts:<domain>:<space>:<accountId>` from the **iframe origin's** localStorage.

### Staging paywall test data

On `lite-stg`, the large space over the 100-macro limit (the one that triggers the paywall) is **`SD`**
(~1230 macros) — same setup as the `zenuml` instance. Use `SD` when you need a real over-threshold Lite
space to verify paywall or macro-count behaviour, instead of re-discovering it each time.
