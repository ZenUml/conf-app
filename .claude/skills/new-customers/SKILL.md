---
name: new-customers
description: >-
  Track genuinely NEW customers across the P&D VISION Marketplace apps (ZenUML full/lite,
  Diagramly, AsyncAPI) by classifying every Marketplace license row against D1 Connect-install
  history — filtering out the Connect→Forge migration backfill and internal/test tenants that
  make raw license counts read as fake growth. Use when asked "who are our new customers",
  "new installs/evals this week/month", "新增客户", "organic growth per app", "did we acquire
  anyone", or before quoting ANY license-count growth number. For revenue/renewals use
  marketplace; for one tenant's profile use tenant.
---

# New Customers

Answers "which **real, external, first-time** customers did we gain in a window, per app" —
not raw license rows.

## Why raw license counts lie (validated 2026-07-12)

Atlassian's staged Connect→Forge migration backfilled **FREE license rows for pre-existing
tenants**: lite got 876 rows in April 2026 (88.7% were Connect installs already in D1, 647 of
them from the 2025-04 launch cohort); full's April/May "spike" (26/27, 15/18) was the same
wave. Reading rows as growth inflates lite by ~18× and invents trends that don't exist.
The fix: join each row's `cloudSiteHostname` to D1 `ClientInstallation` first-seen.

## Quick start

```bash
# from the conf-app repo root
S=.claude/skills/new-customers/scripts/new_customers.py

python3 $S --sync --app all --trend                 # this month's new customers, all apps
python3 $S --from 2026-05-01 --to 2026-07-12 --app lite
python3 $S --app asyncapi --contacts                # incl. technical-contact emails
python3 $S --from 2026-04-01 --to 2026-04-30 --app lite   # see the migration wave filtered
```

`--app` accepts `full` | `lite` | `diagramly` | `asyncapi` | `all` | any raw addonKey.
`--sync` refreshes the marketplace snapshot (marketplace's `mp_report.py sync`, ~15s).
D1 first-seen is cached 24h (`--refresh-d1` to force). `--json` for machine output.

## Classification rules

| Verdict | Rule | Meaning |
|---|---|---|
| `INTERNAL` | domain matches the internal list (whimet\*, zenuml\*, d4c-forge, async-prd, zicjin, danshuitaihejie, \*-stg, lite-dev, mtwtf, nextrelease-sbx, 2023-bug-bounty, diagramly-install-test) | excluded |
| `PRE-EXISTING` | D1 Connect first-seen predates license start by > `--grace` days (default 30) | migration backfill / late row — **not** an acquisition |
| `NEW` | no D1 record (**expected** for Forge-direct installs — ClientInstallation is Connect-only) or first-seen within grace | real acquisition |

## Known caveats

- **my-api (AsyncAPI) is D1-blind**: its Connect worker never persisted installs, so the
  backfill filter can't fire there. Volume is ~1/half-year — eyeball the rows it prints.
- A `FREE` lite row = install, not revenue (lite monetizes via Stripe Layer B — see
  `marketplace`'s `whois`).
- Contact emails exist on eval/paid rows — new evals are outreach candidates (`--contacts`).
- Baselines for sanity-checking output (as of 2026-07): lite ≈ 15-20 NEW/mo,
  diagramly ≈ 2/mo, full ≈ 1-3/mo, asyncapi ≈ 1 per half-year.

## Related skills

| Skill | Use for |
|---|---|
| `marketplace` | revenue, renewals, overdue, lifetime value (hosts the shared snapshot) |
| `tenant` | one domain's full profile / paid status |
