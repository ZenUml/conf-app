---
name: macro-count
description: Investigate per-space macro inventory for one Confluence site, comparing reported Metrics KV inventory with distinct viewed macros and optional D1 coverage. Use for macro counts, space limits and reconciling inventory/usage. Distinguishes actual stock from activity and historical sync rows.
---

# Per-space macro inventory

```bash
python3 .claude/skills/macro-count/scripts/macro_count.py --domain example-tenant --no-d1 --json
```

Read [shared evidence rules](../customer-data/evidence.md) and `mixpanel` for shared semantics. Use bare subdomain for KV and frontend Mixpanel dimensions. The `addonKey` query parameter chooses the product; backend hostname alone does not. Verify actual installed/license variants before selecting records; prefer the applicable fresh record, never simply the largest number.

| Source | Meaning | Limit |
|---|---|---|
| Metrics KV | Reported inventory per space KEY | Include lastUpdated and product; stale or absent reports are not current zero |
| Mixpanel | Distinct macro placements viewed in a stated window, per space KEY | Not stock; deleted/copied placements and tracking gaps affect it |
| D1 | Successfully synced content rows per numeric spaceId | Incomplete history, possible deleted records; no guaranteed upper or lower bound on live inventory |

`--days` selects the Mixpanel window; `--no-kv`, `--no-mixpanel`, `--no-d1` skip sources explicitly. Unavailable/failed sources must remain unknown. Do not substitute the number of create events for stock, or distinct viewed placements for total diagrams.

The helper's existing D1 query is **legacy AppInstance-join coverage only**. For current Forge investigations start with `--no-d1`; inspect deployed schema/migrations before an explicit cloudId query. Current sync code writes `CustomContent.cloudId` and site mapping, so the older statement that Forge can never be scoped to a customer is false. Historical nulls and deployment state still require checking. Use verified cloudId and app identity; a Forge appId is shared across sites and is not a tenant key. Never join numeric spaceId directly to space KEY without a verified map.

Current Graph viewer code emits `macro_viewed`; older windows can lack it. The code's existence does not backfill history. A KV/MP gap warrants investigation of coverage and dates, not a causal conclusion that users churned or a claim that every missing macro was never viewed.

Confluence owns diagram content. These read-only analytics are not a content recovery source or a reason to modify customers' content. Return counts, product, window, timestamps, scope and gaps. Use `customer-followup` for the business decision.
