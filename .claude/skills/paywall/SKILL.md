---
name: paywall
description: Manage the ZenUML Lite paywall rollout (Lite variant only — Full and Diagramly have no restrictions). Decide which domains to enroll in CUSTOMER_SUCCESS_SERVICE (CSS), monitor daily paywall activity, and generate the exact KV commands to execute. Use this skill whenever the user asks about paywall rollout, which clients to enable, the CSS flag, tenant enrollment state, space licensing, or "who should be on the paywall list". Also use when the user asks to check a specific domain's paywall state, wants to understand why a tenant is or isn't seeing the paywall, or wants to A/B compare paywall impact (treatment vs. control tenants).
---

# Paywall Rollout Skill

This skill covers the Lite variant only. Full and Diagramly have no in-app restrictions.

## Default Behaviour (no arguments)

When invoked with no description or extra prompt, run **both** the daily monitoring and A/B impact analysis automatically:

1. (Optional) When debugging a specific tenant, check their Forge app version (Step 0)
2. Read the current CSS flag (Step 1) — the live CSS flag is the authoritative domain list; do not rely on any hardcoded list in this skill
3. Run the parallel Mixpanel queries for the last 1 day (Step M below) — Q1–Q4 in parallel, then Q5 for domains with blocks or high save volume
4. Build the domain table and suggest next steps
5. Run the **A/B Impact Analysis** section — measures paywall friction against control tenants
6. Send a PushNotification with the combined summary (daily highlights + A/B deltas)
7. Run the self-review (Step R below) — surface errors, surprises, and proposed skill improvements

When invoked with "compare", "ab", "impact", or "a/b", run only the **A/B Impact Analysis** section (skip daily monitoring).

---

## Rollout States

Every Lite tenant sits in one of three states. Your job is to determine which state each tenant is in and recommend the next action.

| State | CSS | What user sees |
|-------|-----|----------------|
| **Unrestricted** | ❌ | No paywall at all |
| **Paywall on** | ✅ | Warning at 85 macros (per space), blocked at 100 macros (per space). Single `UpgradePrompt` modal — no persona routing. |
| **Licensed** | any | Space paid via KV license — restrictions bypassed entirely |

> **Historical note:** the previous `PERSONA_AWARE_PAYWALL` (PAP) flag and persona-aware modal routing (BystanderNotice / HeavyCreatorPrompt / ComparisonView) have been removed from the codebase. There is now a single `src/components/UpgradePrompt/UpgradePrompt.vue`. The PAP KV key is dead weight — safe to delete once you've confirmed no other consumer reads it.

## Known Internal Sites

These CSS-enrolled domains are ZenUML's own Confluence instances — not customer tenants. Mark as `internal` in all tables; never count their engagement metrics toward customer enrollment recommendations.

- `zenuml` → zenuml.atlassian.net (production/internal)
- `zenuml-connect` → zenuml-connect.atlassian.net (internal, Connect-era)
- `zenuml-stg` → zenuml-stg.atlassian.net (staging)
- `lite-stg` → staging environment (appears in KV flag; treat as internal in all monitoring tables)

## Tenant geography & regional holidays

Before flagging a day with zero paywall events as an anomaly, check whether the tenant's primary engineering region had a public holiday. **The signature of a holiday is "views drop partially, edits collapse" — passive viewing continues from phones/home, but no one is coding/editing.** Without this check, you'll repeatedly chase phantom "broken paywall" investigations.

To identify a tenant's primary region, run `macro_viewed` with breakdown by `mp_country_code` (string, event property) over the last 30 days, filtered by `client_domain`. Then check that region's holiday calendar against the suspicious day.

**Worked example (linemanwongnai, 2026-04-29):**

| Metric | Apr 28 | Apr 29 | Drop |
|--------|--------|--------|------|
| macro_viewed | 1,056 | 505 | -52% |
| macro_save_succeeded | 8 | 1 | -88% |
| upgrade_action_blocked | 17 | 0 | -100% |

Apr 29 is **Shōwa Day (昭和の日)** — a Japan public holiday and the start of Golden Week. linemanwongnai's events come 37% from Japan / 30% from South Korea / 21% from Thailand, so a JP holiday explains the edit collapse. Edit activity stays depressed through May 5–6 for any JP-heavy tenant during Golden Week.

### Known tenant geographies

| Domain | Primary regions (macro_viewed share, 30d) | Notable holidays to flag |
|--------|-------------------------------------------|--------------------------|
| linemanwongnai | Japan (37%), South Korea (30%), Thailand (21%), Singapore (11%) | JP Golden Week (Apr 29 → May 5–6), JP New Year (Jan 1–3), KR/TH major holidays |
| mcoproduct | Singapore (41%), Hong Kong (33%), Taiwan (19%) | Labour Day May 1 (SG/HK/TW all public holiday — expect ~90% drop); CN New Year (Jan/Feb) |
| airwallex | Singapore (85%), Australia (7%), Hong Kong (3%), Netherlands (3%) | SG Labour Day May 1 (~75% view drop, ~85% edit drop); SG National Day Aug 9; CN New Year (Jan/Feb); AU public holidays minor |
| xendit | Indonesia (81%), Philippines (6%), Singapore (4%), Thailand (2%) | ID Hari Buruh / Labour Day May 1 (~60% view drop, ~95% edit drop); ID Idul Fitri (varies, Mar/Apr); ID Independence Aug 17; ID Christmas Dec 25 |
| (extend as discovered) | | |

When extending this table, run the country breakdown query and capture the top 3–4 regions. Add the holidays that affect those regions' work calendars.

---

## Step 0: Check Forge app version for a specific domain (debugging)

When investigating why a tenant is or isn't seeing the paywall — or why their events look different from peers — start by checking which Forge app version they're on:

```bash
# From the conf-app project root
pnpm forge install list 2>&1 | grep -E "<domain1>|<domain2>"
```

Output columns: `Installation ID | Environment | Site | Atlassian apps | App version | Status`. Same `App version` + `Status: Up-to-date` across tenants means they're all on the same Forge code: minor-version code updates auto-distribute to all installations on the matching major (per [Forge minor versions](https://developer.atlassian.com/platform/forge/versions) — no admin consent required). So when events look inconsistent across tenants on the same major version, **first check the deploy timeline** (see Note below): the inconsistency is usually a date-based event-rename cutover, not per-tenant version drift. Browser bundle caching can briefly delay an updated JS for a single user's session but does not explain tenant-level patterns.

If a tenant shows `Status: Out-of-date`, that's a real version drift case — they need a Forge upgrade. This typically only happens when a major version bump (new permissions/scopes) is pending admin consent.

> **Note on event-name cutover (2026-04-28 → 2026-04-29):** The rename `upgrade_action_blocked` → `paywall_triggered` was merged to master via PR #1051 (commit 4d4d8cb2) on 2026-04-28, then auto-distributed by Forge as a minor-version code update (no major bump, no admin consent — see [Forge minor versions](https://developer.atlassian.com/platform/forge/versions)). Result is a clean date cutover: events emitted **on or before 2026-04-28 are stored as `upgrade_action_blocked`**, events **on or after 2026-04-29 use `paywall_triggered`**. Per-tenant differences in which name appears (e.g. `linemanwongnai` showing only the old name, `vin3s` showing only the new name) reflect *which days that tenant happened to have edit-block events*, not version drift. **Always query both event names for windows that span the cutover date**; for windows entirely after 2026-04-29, `paywall_triggered` alone is sufficient.

---

## Step 1: Read current flag state

Run from the `conf-app` project root to get the live CSS flag value:

```bash
# CSS — stored as JSON
npx wrangler kv key get --namespace-id fe9042cb20994651b0a2ef9e68f9037c --remote "CUSTOMER_SUCCESS_SERVICE"
```

> **IMPORTANT — always use `--remote`**: `wrangler.toml` declares `pages_build_output_dir`, which makes wrangler treat this as a Pages project and default to local Miniflare storage. Without `--remote`, every `kv key get/list` silently reads local state (always empty) and returns "Value not found" — even when the remote namespace has data. Also **never pipe through `2>/dev/null`** on wrangler KV commands — wrangler writes auth prompts and account selection to stdout (not stderr), and suppressing stderr can make it appear to succeed while actually returning stale local data.

> **401 Unauthorized on `--remote`:** the shell has no Cloudflare credentials. Run `npx wrangler login` in an interactive terminal, or export `CLOUDFLARE_API_TOKEN` with at least Workers KV read (and write if updating CSS). Until auth works, skip building the “on CSS?” column from KV and state clearly that the CSS list was unavailable — do not infer enrollment from Mixpanel alone.

Format: `{"zenuml-stg":true,"linemanwongnai":true}` — JSON object, keys are subdomain prefixes.

## Infrastructure constants

| Resource | Value |
|----------|-------|
| KV namespace | `fe9042cb20994651b0a2ef9e68f9037c` |
| D1 production DB | `conf-zenuml-prod` |
| metrics-inspect URL | `https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<domain>` |
| Mixpanel project ID | `3373228` |

> **D1 note:** There are several D1 databases in the account. Only `conf-zenuml-prod` has production data (2.2 GB). `conf-zenuml-dev` and others are empty or staging-only.

> **Event note:** `page_viewed` and `page_updated` in D1 fire for **any Confluence page**, not specifically pages with ZenUML macros — they are useless for paywall monitoring. R2 only stores install/uninstall lifecycle events.
>
> **For paywall monitoring, use:**
> - **Mixpanel `macro_viewed`** (renamed from `view_macro` on 2026-04-28; filtered by `client_domain`) — actual macro view counts and unique users
> - **metrics-inspect** — macro counts per space, to see who is near/over the 100-macro threshold
> - **D1 `UserBehaviorEvent` `page_viewed`** — use only to confirm a tenant is **active on Confluence** (people are using the product), not for macro-specific engagement
>
> **clientDomain format in D1:** stored as full hostname (`linemanwongnai.atlassian.net`), not the KV subdomain prefix (`linemanwongnai`).

---

## Step M: Daily Monitoring Queries (run in parallel)

Use `mcp__claude_ai_Mixpanel__Run-Query` with project_id=3373228, last 1 day, chartType=table, breakdown by `client_domain`.

> **Server name matters.** The `mcp__mixpanel__Run-Query` variant rejects the `report` parameter as a string in some sessions (`Input should be a valid dictionary`). Use the `mcp__claude_ai_Mixpanel__` namespace consistently — it accepts the same payload reliably.

**Correct breakdown schema** (the schema evolves — if validation fails, call `Get-Query-Schema(report_type: 'insights')` first):
```json
"breakdowns": [{"metric": {"type": "property", "propertyName": "client_domain", "propertyType": "string", "resource": "event"}}]
```

Run all 4 queries in parallel:

**Q1 — Paywall block events**
```
event: paywall_triggered, measurement: total
```
> The legacy event name `upgrade_action_blocked` (pre-2026-04-29) is no longer emitted. Only query it if your window crosses 2026-04-28; for any window after 2026-04-29, `paywall_triggered` is the only block event.

**Q2 — Paywall display events**
```
event: upgrade_modal_shown, measurement: total
```
> Persona-routed display events (`bystander_notice_shown`, `persona_comparison_view_shown`) no longer fire — those modals were removed when persona routing was removed. The only display event now is `upgrade_modal_shown`.

**Q3 — Advocacy copy (sole in-modal intent signal)**
```
event: advocacy_message_copied, measurement: total
```
> The Lite paywall modal is advocacy-only: users copy a templated message to admins. Modal product-choice CTA analytics were removed with the pricing cards; **intent capture** is Q3 (`advocacy_message_copied`) only.

**Q4 — Macro save activity** (edit activity baseline + paywall friction signal)
```
event A: macro_save_succeeded, measurement: total
event B: macro_save_failed, measurement: total
event C: paywall_continued_editing, measurement: total
event D: macro_create_succeeded, measurement: total
```
> `saves` = macro_save_succeeded (edits of existing diagrams). `creates` = macro_create_succeeded (first-time saves of new diagrams). Use to compute friction rate: `triggered / (triggered + saves)` per domain — a ratio >50% means users are hitting the wall on most edits, a sign the space is heavily restricted.
> Non-CSS domains with high save volume are CSS enrollment candidates — flag them.

**Q5 — Per-space breakdown for domains with blocks, high save volume, or creates**

For each domain that had triggered > 0 OR saves > 10 OR creates > 0 today, run a per-domain query with metrics filtered by `client_domain` and a single `confluence_space` breakdown. **Use `filters: [...]` (plural array) on each metric, not `filter: {...}`** — wrong shape returns a global aggregate. Concrete shape:

```json
{
  "name": "Q5 <domain> per-space",
  "metrics": [
    {
      "eventName": "paywall_triggered",
      "measurement": {"type": "basic", "math": "total"},
      "filters": [{"type": "string", "propertyName": "client_domain", "propertyType": "string", "resource": "event", "operator": "equals", "value": "<domain>"}]
    },
    {
      "eventName": "macro_save_succeeded",
      "measurement": {"type": "basic", "math": "total"},
      "filters": [{"type": "string", "propertyName": "client_domain", "propertyType": "string", "resource": "event", "operator": "equals", "value": "<domain>"}]
    },
    {
      "eventName": "macro_create_succeeded",
      "measurement": {"type": "basic", "math": "total"},
      "filters": [{"type": "string", "propertyName": "client_domain", "propertyType": "string", "resource": "event", "operator": "equals", "value": "<domain>"}]
    }
  ],
  "breakdowns": [{"metric": {"type": "property", "propertyName": "confluence_space", "propertyType": "string", "resource": "event"}}],
  "chartType": "table",
  "dateRange": {"type": "relative", "range": {"unit": "day", "value": 1}}
}
```

For the `mcoproduct` case where `paywall_continued_editing` is high, add it as a fourth metric with the same `filters` array — the per-space split tells you which space the bouncing user is on.

Run these in parallel after Q1–Q4 complete. Cross-reference space keys against metrics-inspect (`curl https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<domain>`) to get each space's macro count. This catches the pattern where a tenant has heavy spaces (>100 macros) but saves happen in light spaces — which explains zero blocks despite high activity (e.g. mcoproduct: 22 saves all in space MA=52 macros, while TMAB=1546 sits untouched by editors).

> **Sanity check after Q5 runs.** Look at the breakdown `rows` — every space key should plausibly belong to the target tenant. If you see foreign keys (e.g. `vin3s`'s `VPay` showing up in a `mcoproduct` query), the filter wasn't applied; the query returned a global aggregate. Verify the `filters` shape and re-run.

### Build the monitoring table

For customer domains on CSS: **read the live CSS flag from Step 1** to get the current list. Do not rely on any hardcoded list here — it goes stale as new tenants are enrolled. Exclude internal sites: zenuml, zenuml-stg, zenuml-connect.

| Domain | triggered | modal_shown | advocacy_copies | intent_capture_rate | saves | creates | friction | continued | note |
|--------|-----------|-------------|-----------------|---------------------|-------|---------|----------|-----------|------|

- `triggered` = `paywall_triggered`
- `advocacy_copies` = `advocacy_message_copied` (successful clipboard copy from the paywall modal — sole in-modal intent signal)
- `intent_capture_rate` = `advocacy_copies / triggered` when `triggered > 0`, else `—`
- `saves` = `macro_save_succeeded` (edits of existing diagrams)
- `creates` = `macro_create_succeeded` (first-time saves of new diagrams)
- `friction` = triggered / (triggered + saves) — add as a note if > 50%
- `continued` = `paywall_continued_editing`
- `note` — flag high `intent_capture_rate` (users copying the advocacy message), zero copies with high triggers (message may not be landing), or domains in Q1/Q4 but not on CSS (anomaly / enrollment candidate)
- Lead the PushNotification summary with **intent highlights** (top domains by `advocacy_copies` or `intent_capture_rate`) — there is no separate “marketplace vs enterprise” conversion column anymore
- Flag any domain that appears in Q1 or Q4 results but is NOT in the CSS list — that's an anomaly or CSS enrollment candidate

### Per-space sub-table (for domains with blocks, saves > 10, or creates > 0)

| Domain | Space | macros | triggered | saves | creates | note |
|--------|-------|--------|-----------|-------|---------|------|

- `macros` = total from metrics-inspect for that space
- Highlight spaces where macros ≥ 100 and triggered = 0 — these are latent paywall spaces where users edit but haven't hit a blocked user yet (or are view-only)
- Highlight spaces where macros ≥ 100 and triggered > 0 — active paywall spaces
- **Creates bypass the paywall** — `paywall_triggered` fires only on editing existing macros, not on creating new ones. Users in a blocked space can still add new diagrams, pushing the macro count higher and tightening the wall over time. Flag spaces where `creates > 0` and `triggered > 0` — they are self-ratcheting.

### Known anomalous non-CSS domains

These domains have emitted paywall events despite not being in CSS. Treat as likely test traffic or cached bundle artifacts — do not enroll based on these events alone:

| Domain | First seen | Pattern |
|--------|------------|---------|
| woolworths-agile | 2026-05-07 | Group B A/B control tenant (not on CSS). Seen on 2026-05-07 (1 triggered) and 2026-05-08 (1 triggered, 6 saves, 3 creates), and 2026-05-09 (1 triggered again). Three consecutive days — not a cache artifact, investigate code path. |
| gip-onshore | 2026-04-30 | paywall_triggered only |
| rizapg | 2026-05-01 | paywall_triggered + upgrade_modal_shown + macro_save_succeeded |
| olix | 2026-05-02 | high save volume (19 saves/day), no paywall events — likely below 100 macros in active spaces |
| hht-nanoplatform | 2026-05-02 | paywall_triggered + upgrade_modal_shown — not on CSS |
| 99dotco | 2026-05-11 | 2 triggered + 2 modal_shown today (first seen); 3 triggered + 10 saves over 7 days. Not on CSS. Persistent — investigate code path. |

### PushNotification

After building the table, send a PushNotification (single `message` field only — no separate title/body):
- Format: `Paywall Daily {date} | {intent highlights} | {summary}`
- Keep under 200 chars total
- Lead with advocacy/intent stats (e.g. domains with the highest `advocacy_copies` or `intent_capture_rate`), not legacy “marketplace vs enterprise” CTA counts

---

## Step 2: Gather tenant data for CSS enrollment decisions (run in parallel)

> **When to run:** Step 2 is for deciding whether to enroll a non-CSS tenant into CSS (turning the paywall on for them), not daily monitoring. The default flow (no arguments) can skip Steps 2–4 unless the monitoring table shows non-CSS domains with high save volume or near-100-macro spaces. Run Steps 2–4 when: the user asks "who should we enroll in CSS?" or when Step M reveals new tenants with sufficient activity.

For each candidate domain, run these **in parallel**:

```bash
# 1. Macro counts + space data per domain
curl -s "https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<domain>"

# 2. Install age — ClientInstallation uses subdomain prefix (no .atlassian.net)
npx wrangler d1 execute conf-zenuml-prod --remote --command "
SELECT clientDomain, MIN(timestamp) as first_install
FROM ClientInstallation
WHERE clientDomain IN ('zenuml-stg','linemanwongnai','zeptonow','zenuml-connect','zenuml')
GROUP BY clientDomain"

# 3. Recent Confluence activity — UserBehaviorEvent uses FULL hostname (with .atlassian.net)
# Use this only to confirm a tenant is active on Confluence, not for macro engagement
npx wrangler d1 execute conf-zenuml-prod --remote --command "
SELECT clientDomain, action, COUNT(*) as count
FROM UserBehaviorEvent
WHERE clientDomain IN ('linemanwongnai.atlassian.net','zeptonow.atlassian.net')
AND createdAt >= date('now', '-30 days')
GROUP BY clientDomain, action"

# 4. Recent macro activity — Mixpanel only (run per domain, parallelise)
# mcp__mixpanel__Run-Query: event=macro_viewed, filter client_domain equals <domain>,
# measurement unique users, last 30 days, chartType=table
# DO NOT use D1 UserBehaviorEvent/DailyBehaviorCounter — those track all Confluence page views, not macro views
```

> **CRITICAL — D1 clientDomain format mismatch:**
> - `ClientInstallation` stores **subdomain prefix** (`linemanwongnai`)
> - `UserBehaviorEvent` and `DailyBehaviorCounter` store **full hostname** (`linemanwongnai.atlassian.net`)
>
> Always use full hostname when querying `UserBehaviorEvent`/`DailyBehaviorCounter`. Using the subdomain prefix silently returns 0 rows — no error, just wrong data. When in doubt, verify with `LIKE '%linemanwongnai%'` first.

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
| `recommendation` | computed | see Step 3 |

## Step 3: Interpret the table

The paywall is per-space (fires when any single space ≥ 100 macros). So enrollment only matters for tenants with a real chance of crossing that threshold.

- `enroll` — at least 1 space ≥ 100 macros (or top space ≥ 85 and trending up), install ≥ 14d, viewers_30d ≥ 3, saves_7d ≥ 5. Enroll in CSS.
- `monitor` — top space 50–99 macros, active editors. Re-check in a few weeks; not worth enrolling yet.
- `skip` — top space < 50 macros OR viewers_30d < 3. Zero paywall surface area; enrolling would be invisible noise.
- `already_enrolled` — already on CSS. Use the daily monitoring table to track friction.
- `internal` — ZenUML's own site; skip enrollment decisions.

When multiple tenants are `enroll`, add them in order of `top_space_macros` descending (most likely to trigger soonest).

## Step 4: Execute changes

### Add domains to CSS

CSS is JSON — read, parse, add key, write back:

```bash
# Read current value
npx wrangler kv key get --namespace-id fe9042cb20994651b0a2ef9e68f9037c --remote "CUSTOMER_SUCCESS_SERVICE"
# → {"zenuml-stg":true,"linemanwongnai":true}

# Write updated value
npx wrangler kv key put --namespace-id fe9042cb20994651b0a2ef9e68f9037c --remote "CUSTOMER_SUCCESS_SERVICE" '{"zenuml-stg":true,"linemanwongnai":true,"newdomain":true}'
```

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

**Group A (treatment — paywall on).** CSS-enrolled tenants with ≥1 space ≥100 macros and a working baseline of edits in the last 7d. Refresh as enrollments change. Skip any tenant currently in a regional holiday (see Tenant geography table) and skip newly enrolled tenants for 7 days post-enrollment (rollout shock dominates early days).

| Domain | top space (macros) | spaces ≥100 | rationale |
|--------|--------------------|--------------|-----------|
| colesgroup | AGWS=1080 | 8 | High-volume editor, large surface area |
| airwallex | APA=650 | 7 | High-volume editor, multi-space |
| linemanwongnai | (varies) | 5+ | Normal week. Skip during JP Golden Week (Apr 29 → May 6) |
| vin3s | (varies) | 5+ | Heaviest-volume CSS tenant (185 saves/wk, 40 creates/day). Enrolled 2026-05-04 — rollout shock ended 2026-05-11; re-baseline from 2026-05-18 (first clean 7-day window) |
| mcoproduct | TMAB=1546 | 1+ | Edit volume concentrated in 1–2 power users; saves/user often >10 |

Currently too low-volume to count: xendit (0 paywall events even with high save volume — active spaces below threshold), zeptonow (only 16 attempts/wk).

**Group B (control — paywall off).** Comparable tenants NOT on CSS, with ≥1 space ≥100 macros AND save volume of the same order as Group A. The macro-count requirement matters: a control tenant with no spaces over the threshold would never trigger the paywall even if enrolled — there's nothing to compare.

| Domain | top space (macros) | spaces ≥100 | saves/wk |
|--------|--------------------|--------------|----------|
| myntfintech | GCASHPRODUCTS=224, MARCHI=188 | 2 | ~43 |
| hktdc | EOP=223 | 1 | ~48 |
| alterric | DA=176 | 1 | ~23 |
| woolworths-agile | WIQ=145 | 1 | ~32 (sometimes fires anomalous paywall events — known issue) |
| appculqi | CR=194, UPI=136 | 2 | ~34 |
| economical | PA=241 | 1 | ~25 |

> **Excluded controls:** zayogroup (60 total macros, 0 spaces ≥100 — zero paywall surface area). syscobt, creditacceptance, mainspringenergy (high save volume but no spaces ≥100 — same disqualification). suncoragilecoe (qualifies on macro count but redundant with alterric in size band). **aegisepdev** qualifies on macro count (top space=599, 2 spaces ≥100) and has very high save volume (~94/wk) but is excluded because a 5-editor team with ~19 saves/user is not representative — it inflates Group B's saves/user metric and hides the paywall's true productivity impact. If you want a "high-volume control" reading, run aegisepdev as a one-off comparison rather than aggregating it into Group B.

### Step A1: Run the comparison queries

Two queries, last 7 days, broken down by `client_domain`. Don't filter on `client_domain in [...]` — Mixpanel's `equals` operator doesn't accept arrays. Pull all domains and pick out the rows you need.

```
metrics: macro_save_succeeded (total), paywall_triggered (total), macro_viewed (total)
metrics: macro_save_succeeded (unique), macro_viewed (unique)
breakdown: client_domain
date: last 7 days
```

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
- **Regional holidays:** Always check Group A tenants against the Tenant geography table. A tenant in JP Golden Week or SG Labour Day can drop edits to zero — that's not a paywall effect.
- **Newly enrolled tenants:** Hold for 7 days. Day 1 looks dramatic but isn't a steady-state read.

### Baseline snapshot (2026-05-11, last 7 days, expanded groups)

| Group | tenants | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|---------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| **A** | 5 (colesgroup, airwallex, linemanwongnai¹, vin3s², mcoproduct) | 445 | 315 | 760 | 84 | 1,392 | 38,295 | **59%** | 5.3 |
| **B** | 6 (hktdc, myntfintech, woolworths-agile³, appculqi, economical, alterric) | 234 | 3 | 237 | 39 | 375 | 9,766 | **99%** | 6.0 |

Per-tenant breakdown:

| Group | Domain | saves | triggered | attempts | save_users | view_users | views | success_rate | saves/user |
|-------|--------|-------|-----------|----------|------------|------------|-------|--------------|------------|
| A | vin3s² | 185 | 157 | 342 | 34 | 392 | 20,638 | 54% | 5.4 |
| A | airwallex | 100 | 44 | 144 | 21 | 255 | 5,881 | 69% | 4.8 |
| A | colesgroup | 80 | 59 | 139 | 17 | 389 | 4,473 | 58% | 4.7 |
| A | mcoproduct | 55 | 42 | 97 | 6 | 199 | 5,013 | 57% | 9.2 |
| A | linemanwongnai¹ | 25 | 13 | 38 | 6 | 157 | 2,290 | 66% | 4.2 |
| B | hktdc | 57 | 0 | 57 | 8 | 60 | 4,490 | 100% | 7.1 |
| B | myntfintech | 61 | 0 | 61 | 10 | 78 | 2,764 | 100% | 6.1 |
| B | woolworths-agile³ | 34 | 3 | 37 | 6 | 104 | 1,013 | 92% | 5.7 |
| B | appculqi | 34 | 0 | 34 | 5 | 46 | 581 | 100% | 6.8 |
| B | economical | 24 | 0 | 24 | 6 | 71 | 705 | 100% | 4.0 |
| B | alterric | 24 | 0 | 24 | 4 | 16 | 213 | 100% | 6.0 |

**Reading:** 40pp success-rate gap (99% → 59%) — up from 36pp on 2026-05-09. vin3s still in the window with rollout shock days included; saves/user gap widened to 12% (A 5.3 vs B 6.0) but remains below the 25% meaningful threshold. **The paywall has essentially no impact on per-editor save throughput in steady state** — signal lives entirely in success rate (blocked attempts). Next clean read May 18 when both vin3s and linemanwongnai have full post-shock/post-GW 7-day windows.

> ¹ **linemanwongnai:** window May 5–11 still covers Golden Week tail (May 5–6). True clean read from May 12 (7 full post-GW days).
> ² **vin3s:** enrolled 2026-05-04 — rollout shock ends 2026-05-11. This window includes shock days; re-baseline from 2026-05-18.
> ³ **woolworths-agile:** fires anomalous `paywall_triggered` despite not being on CSS — known issue under investigation. Negligible impact on Group B rate.

---

## Debugging a specific tenant

If a user reports they're not seeing the paywall, check in order:

1. **Forge app version** (Step 0): `pnpm forge install list 2>&1 | grep <domain>`. Confirms install status and rules out version drift before deeper investigation.
2. **Is their domain on CSS?** If not, they'll never see the paywall regardless of macro count.
3. **Are they on Lite?** Paywall logic short-circuits to `false` for Full/Diagramly. Check Mixpanel `product_type` property on their `macro_viewed` events.
4. **Per-space macro count ≥ 100?** Paywall is per-space, not per-tenant. A tenant with 5,000 total macros across 100 spaces won't trigger if no single space crosses the threshold. Check `metrics-inspect` and look at top spaces by `total`.
5. **Are users actually trying to EDIT macros in over-threshold spaces?** Paywall fires on edit click (`paywall_triggered`), NOT on viewing. View-only users in a 1,000-macro space generate zero paywall events. Cross-check `macro_viewed` against `macro_save_succeeded` filtered by `client_domain` (and ideally `confluence_space`). **If edit activity collapses on a specific date while views only partially drop, suspect a regional holiday in the tenant's primary engineering geography — see "Tenant geography & regional holidays" section above.**
6. **Is their space licensed?** Check KV: `license:{cloudId}:{spaceKey}`.
7. **Sub-threshold trigger discrepancy?** If `paywall_triggered` fires for a space that `metrics-inspect` shows below 100 macros, suspect a count methodology gap: `metrics-inspect` shows live macro counts, but the frontend paywall check in `useCustomerSuccessService.ts` may use a cached or differently-computed count. Observed cases: vin3s VE (83 macros, 19 triggers on 2026-05-11), vin3s VLEARN (89 macros, 2 triggers), zeptonow Engineerin (25 macros, 3 triggers). Reconcile by adding a debug log in `useCustomerSuccessService.ts` to emit the raw count seen at trigger time.

There is no longer any persona / modal-routing branch — every blocked user sees the same `UpgradePrompt` modal.

For local simulation, use localStorage overrides:
```js
localStorage.mockCSSEnabled = 'true'
localStorage.mockMacroCount = '105'
localStorage.mockSpacePaid = 'false'
```

## Step R: Self-Review (always run after monitoring)

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
