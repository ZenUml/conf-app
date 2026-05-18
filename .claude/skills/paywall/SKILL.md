---
name: paywall
description: Manage the ZenUML Lite paywall rollout (Lite variant only — Full and Diagramly have no restrictions). Decide which domains to enroll in CUSTOMER_SUCCESS_SERVICE (CSS), monitor daily paywall activity, and generate the exact KV commands to execute. Use this skill whenever the user asks about paywall rollout, which clients to enable, the CSS flag, tenant enrollment state, space licensing, or "who should be on the paywall list". Also use when the user asks to check a specific domain's paywall state, wants to understand why a tenant is or isn't seeing the paywall, or wants to A/B compare paywall impact (treatment vs. control tenants).
---

# Paywall Rollout Skill

This skill covers the Lite variant only. Full and Diagramly have no in-app restrictions.

## Default Behaviour (no arguments)

When invoked with no description or extra prompt, run **both** the daily monitoring and A/B impact analysis automatically:

1. Read the current CSS flag (Step 1) — the live CSS flag is the authoritative domain list
2. Run the parallel Mixpanel queries for the last 1 day (Step 2 below) — Q1–Q4 in parallel, then Q5 for domains with blocks or high save volume
3. Build the domain table and suggest next steps
4. Run the **A/B Impact Analysis** section — measures paywall friction against control tenants
5. Send a PushNotification with the combined summary (daily highlights + A/B deltas)
6. Run the self-review (Step 6 below) — surface errors, surprises, and proposed skill improvements

When debugging a specific tenant (version drift, missing paywall, odd events), use **Troubleshooting** below — not part of the numbered daily run.


---

## Rollout States

Every Lite tenant sits in one of three states. Your job is to determine which state each tenant is in and recommend the next action.

| State | CSS | What user sees |
|-------|-----|----------------|
| **Unrestricted** | ❌ | No paywall at all |
| **Paywall on** | ✅ | Warning at 85 macros (per space), blocked at 100 macros (per space). `UpgradePrompt` when an edit is blocked. |
| **Licensed** | any | Space paid via KV license — restrictions bypassed entirely |

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

**Authentication:** the wrapper relies on `npx wrangler` being authenticated. If you get `401 Unauthorized`, run `npx wrangler login` in an interactive terminal or export `CLOUDFLARE_API_TOKEN` with Workers KV read (and write if updating CSS). Until auth works, skip the "on CSS?" column and state clearly that the CSS list was unavailable — do not infer enrollment from Mixpanel alone.

## Infrastructure constants

| Resource | Value |
|----------|-------|
| KV namespace | `fe9042cb20994651b0a2ef9e68f9037c` |
| D1 production DB | `conf-zenuml-prod` |
| metrics-inspect URL | `https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<domain>` |
| Mixpanel project ID | `3373228` |

> **D1 note:** There are several D1 databases in the account. Only `conf-zenuml-prod` has production data (2.2 GB). `conf-zenuml-dev` and others are empty or staging-only.

---

## Step 2: Daily Monitoring Queries

Prefer `scripts/paywall_queries.py` over hand-built Mixpanel payloads. It centralises the segmentation query for every event in this skill so a filter-shape mistake can't silently substitute a global aggregate. It pulls the API secret from `.env.mixpanel` and prints `{event: {breakdown: count}}` as JSON.

```bash
# Q1 + Q3–Q4 in one call (paywall_triggered, advocacy_message_copied,
# macro_save_succeeded, macro_save_failed, paywall_continued_editing,
# macro_create_succeeded — all broken down by client_domain). Q2 was
# removed from the script 2026-05-12; see Q2 below.
python3 .claude/skills/paywall/scripts/paywall_queries.py daily

# Q5 for ALL CSS customer domains in one batch — 4 JQL calls total instead
# of N×4 segmentation calls. Read CSS domains from Step 1, exclude internals.
# Output: {event: {domain: {space: count}}}
# Pass the live CSS list (subdomain prefixes); never hardcode tenant names here.
CSS_DOMAINS=$(python3 .claude/skills/paywall/scripts/css_flag.py get \
  | jq -r 'to_entries[] | select(.value==true) | .key' \
  | grep -vE '^(zenuml|zenuml-stg|zenuml-connect|lite-stg)$')
python3 .claude/skills/paywall/scripts/paywall_queries.py per-space-all \
  --domains $CSS_DOMAINS

# Q5 for a single domain (use only when debugging one tenant, not for daily run)
python3 .claude/skills/paywall/scripts/paywall_queries.py per-space <domain>

# Larger window (default is 1 day)
python3 .claude/skills/paywall/scripts/paywall_queries.py daily --window-days 7
```

The legacy MCP-based approach below is preserved for the cases where the script can't run (`.env.mixpanel` missing, no network, or you need a chart format the script doesn't produce). In those cases use `mcp__claude_ai_Mixpanel__Run-Query` with project_id=3373228, last 1 day, chartType=table, breakdown by `client_domain`. The query reference below documents each event's purpose — read those notes regardless of execution path, since they tell you what each metric *means*.

> **Server name matters (MCP fallback).** The `mcp__mixpanel__Run-Query` variant rejects the `report` parameter as a string in some sessions (`Input should be a valid dictionary`). Use the `mcp__claude_ai_Mixpanel__` namespace consistently — it accepts the same payload reliably.

**Correct breakdown schema (MCP fallback)** (the schema evolves — if validation fails, call `Get-Query-Schema(report_type: 'insights')` first):
```json
"breakdowns": [{"metric": {"type": "property", "propertyName": "client_domain", "propertyType": "string", "resource": "event"}}]
```

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

Cross-reference space keys against metrics-inspect (`curl https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<domain>`) to get each space's macro count. This catches the pattern where a tenant has heavy spaces (>100 macros) but saves happen in light spaces — which explains zero blocks despite high activity. See `private/paywall/runbook.md` for the canonical case study (heavy-space-but-light-saves).

When `paywall_continued_editing` is high for a tenant, the per-space split tells you which space the bouncing user is on — the script already includes that event. See `private/paywall/runbook.md` for a worked case where this concentrates in a single user/space pair.

**MCP fallback for Q5.** If you cannot run the script, build the equivalent Insights query manually: metrics `paywall_triggered`, `macro_save_succeeded`, `macro_create_succeeded`, `paywall_continued_editing`, each with `filters: [{propertyName: "client_domain", operator: "equals", value: "<domain>"}]` — note `filters` is a plural array, not `filter: {...}`. Breakdown by `confluence_space`. Sanity check: every space key in the result should plausibly belong to the target tenant; a foreign key means the filter was ignored.

### Build the monitoring table

**Output format: always render as a markdown table — never as a bullet list or prose.** One row per customer CSS domain (exclude internal sites). The table must appear verbatim in your response under the heading "Step 2: Daily Monitoring Table (last 24h, ending now)".

> **Window semantics (corrected 2026-05-18):** `paywall_queries.py daily --window-days 1` returns events for **today only** (partial day rolling up to the moment the query runs — typically 6-18h of data). Mixpanel ingestion lag is ~5-10 min so today's numbers are fresh enough to monitor "as of now". Earlier behaviour was yesterday-only, which created a 24h blind spot — fixed in `date_range()`. Partial-day numbers will be lower than full-day totals; don't compare a 14:00-run snapshot to a previous-day total without scaling.

For customer domains on CSS: **read the live CSS flag from Step 1** to get the current list. Do not rely on any hardcoded list here — it goes stale as new tenants are enrolled. Exclude internal sites: zenuml, zenuml-stg, zenuml-connect, lite-stg.

| Domain | triggered | modal_shown | advocacy_copies | intent_capture_rate | saves | creates | friction | continued | note |
|--------|-----------|-------------|-----------------|---------------------|-------|---------|----------|-----------|------|

- `triggered` = `paywall_triggered`
- `advocacy_copies` = `advocacy_message_copied` (successful clipboard copy from the paywall modal — sole in-modal intent signal)
- `intent_capture_rate` = `advocacy_copies / triggered` when `triggered > 0`, else `—`. **Can exceed 100%** — a single user may copy the message multiple times (e.g., to multiple recipients). This is the strongest intent signal possible, not a data error. A domain with `intent_capture_rate > 100%` should be the top outreach priority for that day.
- `saves` = `macro_save_succeeded` (edits of existing diagrams)
- `creates` = `macro_create_succeeded` (first-time saves of new diagrams)
- `friction` = triggered / (triggered + saves) — add as a note if > 50%
- `continued` = `paywall_continued_editing`
- `note` — flag high `intent_capture_rate` (users copying the advocacy message), zero copies with high triggers (message may not be landing), or domains in Q1/Q4 but not on CSS (anomaly / enrollment candidate)
- Lead the PushNotification summary with **intent highlights** (top domains by `advocacy_copies` or `intent_capture_rate`) — there is no separate “marketplace vs enterprise” conversion column anymore
- Flag any domain that appears in Q1 or Q4 results but is NOT in the CSS list — that's an anomaly or CSS enrollment candidate

> **Before flagging anything as anomalous, run the Interpretation lens** (top of this skill). For tenant-specific geographies and the holiday-vs-paywall-regression worked example, read `private/paywall/interpretation.md` — only load it when you actually have an anomaly to interpret, not on every run.

### Per-space sub-table (for domains with blocks, saves > 10, or creates > 0)

| Domain | Space | macros | triggered | saves | creates | note |
|--------|-------|--------|-----------|-------|---------|------|

- `macros` = total from metrics-inspect for that space
- Highlight spaces where macros ≥ 100 and triggered = 0 — these are latent paywall spaces where users edit but haven't hit a blocked user yet (or are view-only)
- Highlight spaces where macros ≥ 100 and triggered > 0 — active paywall spaces
- **Creates are gated as of 2026-05-15** (PR #89, `paywall_blocked_create` event). Before that date, creates bypassed the paywall; in any window crossing 2026-05-15, expect `paywall_triggered` for creates to ramp in. Spaces where `creates > 0` and `triggered > 0` are no longer "self-ratcheting" — both edits and creates are now blocked when the space is over the limit. Strategy details: `docs/paywall-strategy.md`.

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
curl -s "https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<domain>"

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
# mcp__mixpanel__Run-Query: event=macro_viewed, filter client_domain equals <domain>,
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

- `enroll` — at least 1 space ≥ 100 macros (or top space ≥ 85 and trending up), install ≥ 14d, viewers_30d ≥ 3, saves_7d ≥ 5. Enroll in CSS.
- `monitor` — top space 50–99 macros, active editors. Re-check in a few weeks; not worth enrolling yet.
- `skip` — top space < 50 macros OR viewers_30d < 3. Zero paywall surface area; enrolling would be invisible noise.
- `already_enrolled` — already on CSS. Use the daily monitoring table to track friction.
- `internal` — ZenUML's own site; skip enrollment decisions.

When multiple tenants are `enroll`, add them in order of `top_space_macros` descending (most likely to trigger soonest).

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
