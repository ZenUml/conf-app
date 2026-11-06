---
name: forge-installs
description: Read current Forge installations and compare successful snapshots for added or removed sites. Use for install counts, new installs, uninstalls, or distribution across Lite, Full, Diagramly and AsyncAPI. Reports missing baselines and unsupported products explicitly.
---

# Forge installs and observed changes

Run from the conf-app repository:

```bash
python3 .claude/skills/forge-installs/scripts/check.py all
python3 .claude/skills/forge-installs/scripts/check.py asyncapi
```

The shared [product registry](../customer-data/products.json) provides identities. `all` covers four configured Forge apps and reports Mini Sites as unavailable until its identity is verified. Do not silently call four products the whole customer portfolio.

The helper calls read-only `forge install list --json` with the selected `APP_ID`. It validates the entire JSON array before saving a private local snapshot under `~/.claude/cache/forge-installs`. It compares environment + site against compatible successful snapshots at least one and seven days old. Display the actual baseline interval; it may be longer than the requested window. Never infer an exact uninstall timestamp from a difference.

First run, missing baseline, changed schema, failed command and unsupported product are explicit unknowns. A successfully read empty JSON array is valid; empty stdout or malformed records are failures and are not saved. Legacy TSV snapshots are not silently treated as compatible JSON baselines.

`--snapshot-dir <private-path>` selects another cache; `--input <saved-json>` validates an offline single-product fixture without queries or writes. `FORGE_CMD` can select an installed CLI executable. The installed CLI must support `install list --json`; inspect its help/source on failure rather than parsing a changed table into zero rows. See [Forge CLI auth](../../../docs/debugging/forge-cli-auth.md) for access issues.

Return counts, relevant added/removed sites, query time, baseline interval and gaps. D1 mirrors can be incomplete; do not substitute their row count for platform installations. Status/version labels alone do not prove a broken installation or user consent requirement.

Use `customer-lifecycle` for combined license/subscription changes and `customer-followup` for decisions or authorised contact. This read-only query does not initiate customer actions.
