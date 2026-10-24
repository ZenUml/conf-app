---
name: new-customers
description: Find Marketplace license-start candidates and known historical installations to distinguish possible new customers from migration, renewal or backfill. Use for new customer/install/evaluation screening and growth checks. A missing D1 record does not confirm a new customer.
---

# New license candidates

```bash
python3 .claude/skills/new-customers/scripts/new_customers.py --sync --app all --trend
python3 .claude/skills/new-customers/scripts/new_customers.py --app lite --from 2026-09-01 --to 2026-09-11 --json
```

`all` uses the four conf-app entries in the shared `customer-data/products.json`. Mini Sites requires a separate Marketplace export using its registered key; do not imply the local snapshot covers it. `--contacts` includes source technical-contact labels, not verified admin roles. D1 history is cached for 24 hours; `--refresh-d1` refreshes it. Report both source freshnesses.

Output changed from `NEW` to **`CANDIDATE`**: no matching D1 record or history near the license start is only a candidate. Known history more than `--grace` days before start is **PRE-EXISTING**, which rules out first acquisition at that date but does not prove which migration/renewal mechanism created the new row. **INTERNAL** excludes the configured internal/test patterns; spot-check ambiguous matches before publishing cohort totals.

A license maintenance-start date is not necessarily installation or first use. Confirm product/site identity, prior licenses and actual install evidence. The trend counts candidate license starts, not acquired companies. Do not label D1-absent sites Forge-direct as a fact. For all recent lifecycle changes use `customer-lifecycle`; for follow-up decisions use `customer-followup`.
