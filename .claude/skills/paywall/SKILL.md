---
name: paywall
description: Manage the ZenUML Lite paywall rollout — analyse which tenants are ready to advance to the next stage, decide which domains to add to CUSTOMER_SUCCESS_SERVICE or PERSONA_AWARE_PAYWALL, and generate the exact KV commands to execute. Use this skill whenever the user asks about paywall rollout, which clients to enable, CSS/PAP flags, tenant upgrade state, space licensing, or "who should be on the paywall list". Also use when the user asks to check a specific domain's paywall state or wants to understand why a tenant is or isn't seeing the paywall.
---

# Paywall Rollout Skill

This skill covers the Lite variant only. Full and Diagramly have no in-app restrictions.

## Default Behaviour (no arguments)

When invoked with no description or extra prompt, run the daily monitoring research automatically:

1. (Optional) When debugging a specific tenant, check their Forge app version (Step 0)
2. Read current CSS/PAP flags (Step 1)
3. Run the parallel Mixpanel queries for the last 1 day (Step M below)
4. Build the domain table and suggest next steps
5. Send a PushNotification with the summary
6. Run the self-review (Step R below) — surface errors, surprises, and proposed skill improvements

---

## Rollout Stages

Every Lite tenant sits in one of four stages. Your job is to determine which stage each CSS-enrolled tenant is in and recommend the next action.

| Stage | CSS | PAP | What user sees |
|-------|-----|-----|----------------|
| **0 — Unrestricted** | ❌ | — | No paywall at all |
| **1 — Legacy paywall** | ✅ | ❌ | Blocked at 100 macros, generic "Pick the upgrade that fits" modal |
| **2 — Persona-aware paywall** | ✅ | ✅ | Blocked at 100 macros, routed to HeavyCreator / Bystander / ComparisonView based on usage |
| **Licensed** | any | any | Space paid via KV license — restrictions bypassed entirely |

The PAP flag is a temporary canary gate. Once validated across all CSS tenants, collapse stages 1 and 2 by removing the PAP gate from `UpgradePromptRouter.vue` and letting all CSS tenants get persona-aware routing automatically.

## Known Internal Sites

These CSS-enrolled domains are ZenUML's own Confluence instances — not customer tenants. Mark as `internal` in all tables; never recommend for PAP promotion based on engagement metrics.

- `zenuml` → zenuml.atlassian.net (production/internal)
- `zenuml-connect` → zenuml-connect.atlassian.net (internal, Connect-era)
- `zenuml-stg` → zenuml-stg.atlassian.net (staging)

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
| (extend as discovered) | | |

When extending this table, run the country breakdown query and capture the top 3–4 regions. Add the holidays that affect those regions' work calendars.

---

## Step 0: Check Forge app version for a specific domain (debugging)

When investigating why a tenant is or isn't seeing the paywall — or why their events look different from peers — start by checking which Forge app version they're on:

```bash
# From the conf-app project root
pnpm forge install list 2>&1 | grep -E "<domain1>|<domain2>"
```

Output columns: `Installation ID | Environment | Site | Atlassian apps | App version | Status`. The same `App version` number across tenants means they all received the same Forge install. **Same App version does NOT guarantee identical client-side JS** — Forge Custom UI bundles are served via Cloudflare Pages and aggressively cached at the browser level. A tenant on App version 8 may still have users running an older JS bundle that emits old event names (e.g. `upgrade_action_blocked` instead of `paywall_triggered`). When events look inconsistent across tenants on the same App version, browser bundle caching is the most likely cause.

If a tenant shows `Status: Out-of-date`, that's the easier case — they need a Forge upgrade and the discrepancy is real version drift.

> **Note on event-name drift (2026-04-30):** A rename of `upgrade_action_blocked` → `paywall_triggered` was made on the feature branch `fix/analytics-rename-action-blocked-to-paywall-triggered` (commit 4d4d8cb2) but **was never merged to master**. The current production code on master still emits `upgrade_action_blocked`. Despite this, a small number of production tenants (e.g. `vin3s`, `gip-onshore`) emit `paywall_triggered` — likely from cached JS, Mixpanel lexicon retrofit, or manual events. Until the rename is actually shipped or the discrepancy is resolved, **query both events** in monitoring to avoid missing data.

---

## Step 1: Read current flag state

Run these two wrangler commands from the `conf-app` project root to get the live flag values:

```bash
# CSS — stored as JSON
npx wrangler kv key get --namespace-id fe9042cb20994651b0a2ef9e68f9037c --remote "CUSTOMER_SUCCESS_SERVICE"

# PAP — stored as comma-separated string (NOT JSON)
npx wrangler kv key get --namespace-id fe9042cb20994651b0a2ef9e68f9037c --remote "PERSONA_AWARE_PAYWALL"
```

> **IMPORTANT — always use `--remote`**: `wrangler.toml` declares `pages_build_output_dir`, which makes wrangler treat this as a Pages project and default to local Miniflare storage. Without `--remote`, every `kv key get/list` silently reads local state (always empty) and returns "Value not found" — even when the remote namespace has data. Also **never pipe through `2>/dev/null`** on wrangler KV commands — wrangler writes auth prompts and account selection to stdout (not stderr), and suppressing stderr can make it appear to succeed while actually returning stale local data.

Note the formats — they differ intentionally:
- **CSS** → `{"zenuml-stg":true,"linemanwongnai":true}` — JSON object, keys are subdomain prefixes
- **PAP** → `"zenuml,zenuml-stg"` — plain comma-separated string, NO JSON

Writing JSON to PAP silently breaks it (flag always returns false). Always write PAP as a plain string.

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

Use `mcp__mixpanel__Run-Query` with project_id=3373228, last 1 day, chartType=bar, breakdown by `client_domain` (string, event property). Run all 4 in parallel:

**Q1 — Paywall block events** (multi-metric: query BOTH event names — see version-drift note in Step 0)
```
event A: paywall_triggered, measurement: total          # new name (post-rename)
event B: upgrade_action_blocked, measurement: total     # legacy name (still emitted by current master code + cached browser bundles)
```
> Treat the `triggered` column in the table as `paywall_triggered + upgrade_action_blocked` summed per domain. Never query only one — you will miss data. As of 2026-04-30, `linemanwongnai` and `xendit` emit ONLY the legacy name; `vin3s` and `gip-onshore` emit ONLY the new name; tenants like `colesgroup` emit BOTH.

**Q2 — Paywall display events** (multi-metric: which modal was shown)
```
event A: bystander_notice_shown, measurement: total
event B: persona_comparison_view_shown, measurement: total
event C: upgrade_modal_shown, measurement: total
```

**Q3 — Marketplace CTA clicks**
```
event: upgrade_cta_clicked, filter: product_option equals "marketplace", measurement: total
```

**Q4 — Enterprise bundle CTA clicks**
```
event: upgrade_cta_clicked, filter: product_option equals "enterprise_bundle", measurement: total
```

> Note: header-badge clicks no longer fire `upgrade_cta_clicked`. Only modal product-choice clicks do, so `product_option` is always `marketplace` or `enterprise_bundle`.

### Build the monitoring table

For these 7 customer PAP domains (exclude internal sites): **colesgroup, linemanwongnai, airwallex, mcoproduct, xendit, zenuml, zeptonow**

| Domain | triggered (new+legacy) | bystander | comparison | marketplace | enterprise | signal |
|--------|------------------------|-----------|------------|-------------|------------|--------|

- `triggered` = sum of `paywall_triggered` + `upgrade_action_blocked` for that domain
- `signal` = **UPGRADE** if marketplace > 0 or enterprise > 0, else `—`
- Lead the summary with **CONVERSION ALERT** if any domain has signal = UPGRADE
- Flag any domain that appears in Q1 results but is NOT in the CSS list — that's an anomaly worth investigating (e.g. `vin3s`, `gip-onshore` on 2026-04-30 emit `paywall_triggered` despite not being CSS-enrolled)

### PushNotification

After building the table, send a PushNotification:
- Title: `Paywall Daily {date}`
- Body: key highlights + summary line (under 200 chars total)
- Lead with `CONVERSION ALERT` if any UPGRADE signal

---

## Step 2: Gather tenant data for promotion decisions (run in parallel)

For each CSS domain, run these **in parallel**:

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

The metrics-inspect response includes `data.total` (total macros across all spaces) — use this as the primary activity proxy when viewer counts are sparse.

Build a promotion recommendation table with these columns:

| Column | Source | Meaning |
|--------|--------|---------|
| `domain` | KV | Subdomain prefix |
| `stage` | KV | 1 = CSS only, 2 = CSS + PAP |
| `install_age_d` | D1 ClientInstallation.timestamp | Days since first Connect install |
| `total_macros` | metrics-inspect data.total | Total macros across all spaces |
| `viewers_30d` | Mixpanel `macro_viewed` | Unique macro viewers, last 30d |
| `recommendation` | computed | see Step 3 |

## Step 3: Interpret the table

The recommendation is computed from the same logic as `tenantSize.ts`:

- `insufficient_data` — install < 30 days OR viewers_30d < 3. Don't add to PAP yet; not enough signal for persona routing to be meaningful.
- `promote_to_pap` — install ≥ 30d, viewers_30d ≥ 3, not yet on PAP. This tenant is ready.
- `monitor` — on PAP already but `tenant_size = unknown`. Keep watching — may need more time.
- `already_pap` — fully promoted, tenant_size has signal. Healthy.
- `internal` — ZenUML's own site; skip for promotion decisions.

When multiple tenants are `promote_to_pap`, add them in order of `viewers_30d` descending (most active first — more likely to trigger persona routing meaningfully).

## Step 4: Execute changes

### Add domains to PAP

Read the current PAP value first, append the new domain(s), write back as a plain string:

```bash
# Read current value
npx wrangler kv key get --namespace-id fe9042cb20994651b0a2ef9e68f9037c --remote "PERSONA_AWARE_PAYWALL"
# → "zenuml"

# Write updated value (plain string, no quotes in the value itself)
npx wrangler kv key put --namespace-id fe9042cb20994651b0a2ef9e68f9037c --remote "PERSONA_AWARE_PAYWALL" "zenuml,linemanwongnai,zeptonow"
```

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

## Debugging a specific tenant

If a user reports they're not seeing the paywall (or seeing the wrong modal), check in order:

1. **Forge app version** (Step 0): `pnpm forge install list 2>&1 | grep <domain>`. Confirms install status and rules out version drift before deeper investigation.
2. **Is their domain on CSS?** If not, they'll never see the paywall regardless of macro count.
3. **Are they on Lite?** Paywall logic short-circuits to `false` for Full/Diagramly. Check Mixpanel `product_type` property on their `macro_viewed` events.
4. **Per-space macro count ≥ 100?** Paywall is per-space, not per-tenant. A tenant with 5,000 total macros across 100 spaces won't trigger if no single space crosses the threshold. Check `metrics-inspect` and look at top spaces by `total`.
5. **Are users actually trying to EDIT macros in over-threshold spaces?** Paywall fires on edit click (`upgrade_action_blocked` / `paywall_triggered`), NOT on viewing. View-only users in a 1,000-macro space generate zero paywall events. Cross-check `macro_viewed` against `macro_edit_opened` / `macro_save_succeeded` filtered by `client_domain` (and ideally `confluence_space`). **If edit activity collapses on a specific date while views only partially drop, suspect a regional holiday in the tenant's primary engineering geography — see "Tenant geography & regional holidays" section above.**
6. **Is their space licensed?** Check KV: `license:{cloudId}:{spaceKey}`.
7. **Which modal will they see?** Depends on PAP flag + persona:
   - PAP off → LegacyPrompt
   - PAP on + personalAuthored < 5 → BystanderNotice (unless `ownerSelfIdentified`)
   - PAP on + tenantSize unknown → ComparisonView
   - PAP on + tenantSize known + creator → HeavyCreatorPrompt

For local simulation, use localStorage overrides:
```js
localStorage.mockCSSEnabled = 'true'
localStorage.mockPersonaAwarePaywall = 'true'
localStorage.mockMacroCount = '105'
localStorage.mockSpacePaid = 'false'
localStorage.mockPersonalAuthored = '7'        // ≥5 = creator
localStorage.mockTenantSizeEstimate = 'small_likely'
localStorage.mockPersonaThreshold = '5'        // default M threshold
```

## Step R: Self-Review (always run after monitoring)

After completing the monitoring run, review what happened and propose skill improvements. Do this every time — not just when something went wrong.

### What to check

1. **Errors or unexpected results** — did any query fail, return unexpectedly empty results, or require a workaround not covered in the skill? If so, document the fix.

2. **Event name drift** — did any event return 0 results that should have data? Could be a rename, a drop, or a new event name. Check with `mcp__mixpanel__Get-Events` if suspicious.

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

If there are proposed improvements, ask the user: "Want me to apply these to the skill?" — do not self-edit without confirmation.

---

## Reference: Source files

| What | File |
|------|------|
| Thresholds (85/100) | `src/composables/useCustomerSuccessService.ts` |
| Modal routing | `src/components/UpgradePrompt/UpgradePromptRouter.vue` |
| Persona threshold (M=5) | `src/composables/useCustomerSuccessService.ts:16` |
| Tenant size algorithm | `functions/utils/tenantSize.ts` |
| Space license endpoint | `functions/api/space-status.ts`, `functions/api/space-license.ts` |
| Pricing tiers + cost formula | `docs/pricing-model.yml` |
