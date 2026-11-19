---
name: new-customers
description: Query recent Confluence customer/license/trial candidates through live licenses-only Marketplace API reads. Handles 查 Confluence app 过去 N 天的新客户, defaulting to one approximate day and seven products. License starts do not prove first installation; investigate prior history only for candidates.
---

# New license candidates

For “查 Confluence app 过去 N 天的新客户”, default N to 1 and run from conf-app:

```bash
python3 .claude/skills/new-customers/scripts/new_customers.py --live --days 1 --app all
python3 .claude/skills/new-customers/scripts/new_customers.py --live --days 7 --app all
python3 .claude/skills/new-customers/scripts/new_customers.py --live --from 2026-10-31 --to 2026-11-01 --app all
```

`--live` always makes fresh Marketplace **licenses GETs**, reusing the existing `mp_report.py` reader and credentials. It does not read transactions, refresh the legacy database, query D1/Forge, write CRM, contact customers or schedule monitoring. Do not use `--sync` for this request: legacy sync also reads sales transactions. Access refusal is a failed query, never an empty result; stop the refused action without switching routes to bypass it.

Live `all` covers **Lite, Full, Diagramly, AsyncAPI, AWS Widgets, Whiteboard and Mini Sites** using `recent_customer_scan` in the shared product registry. `--app` also accepts each registered alias. Defaults: `--days 1`, `--timezone Australia/Melbourne`. An N-day request uses the local date N days ago through today's date, inclusive; it approximates elapsed days and is not an exact hourly window. Explicit dates require both `--from` and `--to`. Return the actual date window, timezone, per-product query time/read status and source URL. Output is JSON on stdout; `--env` selects an existing credential file without creating credentials.

For every product, base the new-customer screening on **`maintenanceStartDate`** and report `license_start_candidates`. `lastUpdated` is an update date, never a new-customer start. FREE licenses normally have no trial date: do not warn, require trial coverage or request a webpage check for that absence. For paid-product records, an available `latestEvaluationStartDate` may be shown separately in `evaluation_start_candidates`; it does not change the basic start-date result or candidate site count. Keep source IDs, product, site and original date; `unique_candidate_sites` deduplicates the maintenance-start candidates within each product, while a combined total must deduplicate across products. Candidates are not proof of strict first installation.

Only when maintenance-start candidates exist, inspect existing source-backed site/product history and prior licenses to distinguish internal sites, existing-company/new-product cases, renewal/migration and possible first acquisition. Use the shared evidence rules and existing tenant/history tools within authorized scope; avoid transaction-reading commands for a licenses-only request. Do not automatically exclude a site based on missing D1 history or an ambiguous substring. Preserve unresolved candidates and the unavailable evidence instead of claiming confirmed new customers. No additional history lookup is needed when the maintenance-start candidate list is empty.

## Legacy historical analysis

The original snapshot/D1 analysis remains available without `--live`:

```bash
python3 .claude/skills/new-customers/scripts/new_customers.py --app lite --from 2026-09-01 --to 2026-09-11 --json
```

Legacy `all` uses the four conf-app entries in the shared `customer-data/products.json`; it does not cover the three additional live products. `--contacts` includes source technical-contact labels, not verified admin roles. D1 history is cached for 24 hours; `--refresh-d1` refreshes it. Report both source freshnesses.

Output changed from `NEW` to **`CANDIDATE`**: no matching D1 record or history near the license start is only a candidate. Known history more than `--grace` days before start is **PRE-EXISTING**, which rules out first acquisition at that date but does not prove which migration/renewal mechanism created the new row. **INTERNAL** excludes the configured internal/test patterns; spot-check ambiguous matches before publishing cohort totals.

A license maintenance-start date is not necessarily installation or first use. Confirm product/site identity, prior licenses and actual install evidence. The trend counts candidate license starts, not acquired companies. Do not label D1-absent sites Forge-direct as a fact. For all recent lifecycle changes use `customer-lifecycle`; for follow-up decisions use `customer-followup`.
