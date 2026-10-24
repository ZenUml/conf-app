# Daily macro-count snapshots

The Lite app can build one complete, tenant-wide macro inventory per day for
installations enrolled in `CUSTOMER_SUCCESS_SERVICE`. The Forge scheduled
function searches the two Lite custom-content types directly; it does not scan
Confluence pages or page bodies.

## Storage and retention

- R2 history prefix: `macro-count/v1/`
- R2 retention: 90 days
- Latest product-facing value: the existing
  `metrics:${clientDomain}:lite` KV object
- KV retention: 365 days, refreshed after every successful snapshot commit

The existing `EVENT_BUCKET` cannot host this history: its current lifecycle
configuration expires every object after seven days. Snapshot history therefore
uses the dedicated `MACRO_COUNT_SNAPSHOT_BUCKET` binding so its 90-day policy
cannot change retention for unrelated analytics data.

Before deploying each environment, create its bucket if it is absent:

```bash
pnpm wrangler r2 bucket create conf-macro-count-snapshots-stg
pnpm wrangler r2 bucket create conf-macro-count-snapshots-prod
```

Then add the lifecycle rule to each bucket:

```bash
pnpm wrangler r2 bucket lifecycle add conf-macro-count-snapshots-stg \
  macro-count-snapshots-90d macro-count/v1/ --expire-days 90
pnpm wrangler r2 bucket lifecycle add conf-macro-count-snapshots-prod \
  macro-count-snapshots-90d macro-count/v1/ --expire-days 90
```

Run `lifecycle list` for both buckets and verify that the rule is enabled, its
prefix is exactly `macro-count/v1/`, and its expiration is 90 days. These are
release configuration steps; application deployment does not create buckets or
bucket lifecycle rules.

## Release gates

1. Deploy Cloudflare and Forge to staging.
2. Record the Forge CLI's actual major/minor classification after adding the
   Remote `storage` declaration. Do not infer this from the manifest diff.
3. Run one enrolled internal Lite installation and compare its complete R2/KV
   totals with a separately paginated custom-content query.
4. Inspect uploaded R2 rows and confirm that no diagram body, title, author,
   email, FIT, or OAuth token was stored.
5. Confirm that a forced failed run leaves the previous KV object unchanged.
