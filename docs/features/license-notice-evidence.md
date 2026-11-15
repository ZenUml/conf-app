# Full license notice evidence

The `no-license-notice-enabled` Forge flag controls rollout. A Full viewer shows the notice only for an explicitly inactive Forge license, an explicit Forge `license.type === 'LEGACY_FREE'`, or fresh Marketplace evidence for its own installation. A currently active Forge license wins. Missing/malformed license fields by themselves mean unknown and do not show a notice.

Marketplace `LEGACY_FREE` means an expired/cancelled paid subscription whose app was not uninstalled; its report status can still be `active`. Sources: [license definitions](https://developer.atlassian.com/platform/marketplace/licenses/) and [MP-556](https://jira.atlassian.com/browse/MP-556). Do not classify it as a valid free entitlement merely from that status.

## When Forge omits the license

`GET /api/license-notice` verifies the Forge Invocation Token for the Full app. It reads `cloudId` and environment from the verified token, ignoring query/body identity. No Forge user token is required, so guests can receive the same installation-level notice. A current active license in the verified FIT suppresses older evidence too.

The endpoint reads only `KV_FEATURE_FLAGS`, at `license-notice:<Full app ID>:<environment>:<cloudId>`. Each record is a fresh Marketplace fact, not a rollout flag or a license grant:

```json
{
  "schemaVersion": 1,
  "licenseType": "LEGACY_FREE",
  "source": "atlassian_marketplace",
  "checkedAt": "2026-11-11T09:00:00.000Z",
  "expiresAt": "2026-11-12T09:00:00.000Z",
  "entitlementId": "example-entitlement"
}
```

The server rejects future check times, expired records, malformed data and validity windows longer than 7 days (the helper writes 24 hours unless told otherwise; see `--valid-hours` below). Missing records or lookup errors return `state: unknown`. Responses are not cached. The viewer independently checks the response's freshness; its optional lookup times out after two seconds and never delays diagram rendering or saving. No request to this endpoint starts when the flag is off, the variant is not Full, or Forge already supplies an active/inactive decision.

## Prepare and apply a verified record

Run from the repository root with the existing local Marketplace credentials. The helper uses a fresh complete Full export, checks every matching cloudId entitlement (including hostname aliases), and refuses any active non-Legacy-Free entitlement, including a new trial or purchase. It creates a new private file with mode 0600 and does not change KV.

```sh
python3 scripts/prepare-license-notice-evidence.py --domain example-tenant --environment production --output /absolute/private/path/evidence.json
```

Review the result, then use the existing Wrangler KV bulk-put command against the environment's `KV_FEATURE_FLAGS` namespace with `--remote`; never use a guessed namespace. The entry has a KV expiration as well as application-level timestamps. The evidence must be refreshed from Marketplace before its expiry to continue the notice; there is no automatic refresh job. A missing refresh stops the fallback warning. Re-run the helper before each refresh so a renewal is rechecked.

`--valid-hours N` sets the window (1 to 168 hours, default 24). A longer window means a site that buys a license while Forge omits its license fields can still see the notice until the record expires or is deleted, so pair any window longer than 24 hours with a daily check: re-run the helper, and when it refuses with "Active non-LEGACY_FREE entitlement" or "No LEGACY_FREE Marketplace evidence", delete the key with `wrangler kv key delete <key> --namespace-id <KV_FEATURE_FLAGS id> --remote`. A transient export failure must not delete anything. The Forge rollout rule remains independently necessary; an evidence record alone cannot enable the notice.

Real sites, cloudIds and output artifacts belong in `private/`. Do not commit them in this document or scripts. Do not use development/staging fixtures as production evidence.

## Analytics and validation

`license_notice_evaluated` records the completed eligibility decision for flag-enabled viewers (including active, unknown and unavailable). Flag-off views emit no evaluation event. `license_notice_shown` remains the actual component-mount exposure event and starts session replay. Both carry `license_notice_basis` when known: `forge_inactive`, `forge_legacy_free`, `marketplace_legacy_free`, or a non-production `development_mock`. An eligible evaluation is not proof that a notice rendered: load-failure UI can suppress it.

Use the `Viewer/LicenseNotice` Storybook cases for explicit Legacy Free, verified Marketplace evidence, missing unknown licenses, expired evidence and active-license precedence. Validate the same candidate through Storybook, Forge Tunnel and CI-deployed staging in that order. Production rollout and an actual production exposure remain separate from staging validation.
