---
name: paywall
description: Manage the ZenUML Lite paywall rollout — analyse which tenants are ready to advance to the next stage, decide which domains to add to CUSTOMER_SUCCESS_SERVICE or PERSONA_AWARE_PAYWALL, and generate the exact KV commands to execute. Use this skill whenever the user asks about paywall rollout, which clients to enable, CSS/PAP flags, tenant upgrade state, space licensing, or "who should be on the paywall list". Also use when the user asks to check a specific domain's paywall state or wants to understand why a tenant is or isn't seeing the paywall.
---

# Paywall Rollout Skill

This skill covers the Lite variant only. Full and Diagramly have no in-app restrictions.

## Rollout Stages

Every Lite tenant sits in one of four stages. Your job is to determine which stage each CSS-enrolled tenant is in and recommend the next action.

| Stage | CSS | PAP | What user sees |
|-------|-----|-----|----------------|
| **0 — Unrestricted** | ❌ | — | No paywall at all |
| **1 — Legacy paywall** | ✅ | ❌ | Blocked at 100 macros, generic "Pick the upgrade that fits" modal |
| **2 — Persona-aware paywall** | ✅ | ✅ | Blocked at 100 macros, routed to HeavyCreator / Bystander / ComparisonView based on usage |
| **Licensed** | any | any | Space paid via KV license — restrictions bypassed entirely |

The PAP flag is a temporary canary gate. Once validated across all CSS tenants, collapse stages 1 and 2 by removing the PAP gate from `UpgradePromptRouter.vue` and letting all CSS tenants get persona-aware routing automatically.

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

> **D1 note:** There are several D1 databases in the account. Only `conf-zenuml-prod` has production data (2.2 GB). `conf-zenuml-dev` and others are empty or staging-only.

> **Event note:** `page_viewed` and `page_updated` in D1 fire for **any Confluence page**, not specifically pages with ZenUML macros — they are useless for paywall monitoring. R2 only stores install/uninstall lifecycle events. Mixpanel tracking for these events is commented out (`functions/forge-user-behavior.ts:62`).
>
> **For paywall monitoring, use:**
> - **Mixpanel `view_macro`** (filtered by `client_domain`) — actual macro view counts and unique users
> - **metrics-inspect** — macro counts per space, to see who is near/over the 100-macro threshold
> - **D1 `UserBehaviorEvent` `page_viewed`** — use only to confirm a tenant is **active on Confluence** (people are using the product), not for macro-specific engagement
>
> **clientDomain format in D1:** stored as full hostname (`linemanwongnai.atlassian.net`), not the KV subdomain prefix (`linemanwongnai`).

## Step 2: Gather tenant data (run in parallel)

For each CSS domain, run these **in parallel**:

```bash
# 1. Macro counts + space data per domain (run all in parallel)
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
# mcp__mixpanel__Run-Query: event=view_macro, filter client_domain equals <domain>,
# measurement unique users, last 30 days, chartType=table
# DO NOT use D1 UserBehaviorEvent/DailyBehaviorCounter — those track all Confluence page views, not macro views
```

> **CRITICAL — D1 clientDomain format mismatch:**
> - `ClientInstallation` stores **subdomain prefix** (`linemanwongnai`)
> - `UserBehaviorEvent` and `DailyBehaviorCounter` store **full hostname** (`linemanwongnai.atlassian.net`)
>
> Always use full hostname when querying `UserBehaviorEvent`/`DailyBehaviorCounter`. Using the subdomain prefix silently returns 0 rows — no error, just wrong data. When in doubt, verify with `LIKE '%linemanwongnai%'` first.

The metrics-inspect response includes `data.total` (total macros across all spaces) — use this as the primary activity proxy when viewer counts are sparse.

Build a recommendation table with these columns:

| Column | Source | Meaning |
|--------|--------|---------|
| `domain` | KV | Subdomain prefix |
| `stage` | KV | 1 = CSS only, 2 = CSS + PAP |
| `install_age_d` | D1 ClientInstallation.timestamp | Days since first Connect install |
| `total_macros` | metrics-inspect data.total | Total macros across all spaces |
| `viewers_30d` | Mixpanel `view_macro` | Unique macro viewers, last 30d |
| `recommendation` | computed | see Step 3 |

## Step 3: Interpret the table

The recommendation is computed from the same logic as `tenantSize.ts`:

- `insufficient_data` — install < 30 days OR viewers_30d < 3. Don't add to PAP yet; not enough signal for persona routing to be meaningful.
- `promote_to_pap` — install ≥ 30d, viewers_30d ≥ 3, not yet on PAP. This tenant is ready.
- `monitor` — on PAP already but `tenant_size = unknown`. Keep watching — may need more time.
- `already_pap` — fully promoted, tenant_size has signal. Healthy.

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

1. **Is their domain on CSS?** If not, they'll never see the paywall regardless of macro count.
2. **Do they have ≥ 100 macros in this space?** Check via D1 or `metrics-inspect`.
3. **Is their space licensed?** Check KV: `license:{cloudId}:{spaceKey}`.
4. **Which modal will they see?** Depends on PAP flag + persona:
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

## Reference: Source files

| What | File |
|------|------|
| Thresholds (85/100) | `src/composables/useCustomerSuccessService.ts` |
| Modal routing | `src/components/UpgradePrompt/UpgradePromptRouter.vue` |
| Persona threshold (M=5) | `src/composables/useCustomerSuccessService.ts:16` |
| Tenant size algorithm | `functions/utils/tenantSize.ts` |
| Space license endpoint | `functions/api/space-status.ts`, `functions/api/space-license.ts` |
| Pricing tiers + cost formula | `docs/pricing-model.yml` |
