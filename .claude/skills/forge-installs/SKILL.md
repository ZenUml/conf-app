---
name: forge-installs
description: >
  [lite|full|diagramly|all] — Count Forge app installs per environment
  (production / staging / development) for any of the three ZenUML conf-app variants,
  plus delta vs prior snapshots from 1 day and 7 days ago (which sites were added /
  removed since the last check). Use whenever the user asks "how many installs",
  "how many tenants", "how many customers have installed [variant]", "install count",
  "any new installs", "did anyone uninstall", "active sites", "where is [variant] installed",
  "list installs", "show installed sites" — including bare phrases like
  "diagramly installs", "lite installs", "full installs". Source-of-truth is Atlassian's
  Forge platform via `forge install list` — the D1 `ForgeInstallation` mirror has been
  observed significantly out of sync (e.g. 7 D1 rows vs 49 actual installs for
  diagramly, and the last D1 row was from Apr 9 despite weeks of new installs since),
  so always use this skill, not a D1 query, when the user wants accurate counts or
  recent-install signal.
---

# Forge App Install Counts + Deltas

Answers "how many installs does X have?" *and* "what changed since last time?" for the three ZenUML conf-app variants. Hits Atlassian's Forge API directly via the `forge` CLI — bypasses our D1 mirror, which is unreliable.

## Variants and App IDs

| Variant | App name (Atlassian-side) | `APP_ID` |
|---|---|---|
| `lite` | ZenUML Diagrams and Open API Lite | `8ad26115-211f-4216-971b-0540f606303d` |
| `full` | ZenUML Diagrams for Confluence | `d9e4002b-120b-426b-834b-402a4a5adce7` |
| `diagramly` | Diagramly For Confluence | `01ede8b1-4e88-451a-b9ef-89eeef93afaf` |

If these ever look wrong, verify against D1's `ForgeApp` table:
```bash
npx wrangler d1 execute conf-zenuml-prod --remote --config wrangler-prod.toml --env production \
  --command "SELECT appId, name FROM ForgeApp" --json
```

## Usage

The skill is implemented as a Python script. Run it with the desired variant:

```bash
python3 .claude/skills/forge-installs/scripts/check.py <variant>
```

Arguments:
- `lite` / `full` / `diagramly` — single variant
- `all` (or no argument) — all three

The script:
1. Calls `forge install list` with `APP_ID=<variant-id>` set
2. Strips ANSI color codes, parses the box-drawing-char table, filters to data rows (env ∈ {production, staging, development})
3. Counts rows per environment and prints the totals
4. Saves a TSV snapshot under `~/.claude/cache/forge-installs/<variant>-<iso-timestamp>.tsv`
5. Compares against the most recent snapshot from at least 1 day ago and from at least 7 days ago — prints added / removed sites and the net delta for each window

## Output shape

```
Snapshot dir: /Users/<you>/.claude/cache/forge-installs

=== diagramly  (Diagramly For Confluence, appId=01ede8b1-4e88-451a-b9ef-89eeef93afaf) ===
  Current installs:
    production     49
    staging         2
    development     2
    Total          53
  Δ past 1 day  (vs snapshot from 2026-05-15 08:00:00, net +1):
    Added (+1):
      + production   newcustomer.atlassian.net
    Removed: 0
  Δ past 7 days  (vs snapshot from 2026-05-09 08:00:00, net +5):
    Added (+6):
      + production   newcustomer.atlassian.net
      + production   anothercustomer.atlassian.net
      …
    Removed (-1):
      − production   churnedcustomer.atlassian.net
```

If there's no usable prior snapshot (first run, or no snapshot older than the window), the script prints `no baseline yet — snapshot saved, rerun in <N>d for a delta` for that window. Don't surprise the user with a confusing "0 added, 0 removed" when the reality is "we don't know yet" — the script's wording handles this correctly already.

## Reporting it back to the user

Present results as a per-variant table that bundles the count + the two deltas. Sites in the added/removed lists are the most actionable info — surface the domain names verbatim. Example:

```
## Forge Installs

### Diagramly  (49 prod / 2 stg / 2 dev — total 53)
Past 1 day:  +1 (newcustomer.atlassian.net)
Past 7 days: net +5 (6 added, 1 removed)
  Added:    newcustomer, anothercustomer, …
  Removed:  churnedcustomer
```

When the deltas are 0 / `no baseline yet` for both windows, condense to a single line — don't pad with empty "Added: 0 / Removed: 0" bullets that the user has to scan past.

## Why snapshot-and-diff (not query D1)

Two existing telemetry sources both fall short for the "new installs in past N days" question:

| Source | Issue |
|---|---|
| D1 `ForgeInstallation.createdAt` | Lifecycle handler stopped recording reliably — for diagramly the last row is 2026-04-09, yet there are 49 active installs today. Cannot trust as a recency signal. |
| R2 `atlassian-events/{domain}/lifecycle/{isoDate}.json` | Canonical, but `wrangler r2 object` doesn't support `list` — you can only `get`/`put`/`delete` by path. Without a list operation, you can't enumerate "all installs created in the last N days" without already knowing the domain set. |

So we sidestep both by snapshotting the source-of-truth `forge install list` output ourselves and diffing across runs. This is robust to backend sync gaps and produces deterministic deltas. The trade-off: deltas only work if you've actually been running this skill — there's no historical backfill. On first run for any variant, the 1d/7d windows correctly report "no baseline yet" rather than fabricating a number.

## Combining with Mixpanel for engagement signal

A useful follow-up to the install count is the **WAU/install ratio** — the gap between latent reach (installs) and active engagement (weekly macro views). For example, diagramly today: 49 installs, 5 distinct sites with `macro_viewed` in 7 days = ~10% WAU/install. The "Low engagement on Diagramly for Confluence app" task on the Flywheel board is concrete: ~44 of 49 installs are inert.

When the user is asking about a variant's health (not just its distribution), surface the WAU/install ratio alongside the count. To get the active-site list for a variant, use the `/health-check` skill (which already filters by `product_type`).

## Auth troubleshooting

If `forge install list` fails with "Not logged in" or keychain errors, no amount of snapshot-diffing helps — the underlying CLI call is dead. See [docs/debugging/forge-cli-auth.md](../../../docs/debugging/forge-cli-auth.md):

1. `pnpm rebuild keytar` (in case the native binding wasn't built)
2. `security set-keychain-settings ~/Library/Keychains/login.keychain-db` (reset auto-lock)
3. `forge login` from a real Terminal (the prompts need a TTY)
4. Or set `FORGE_EMAIL` + `FORGE_API_TOKEN` env vars as the non-interactive path

Env vars are the fastest unblock if the user doesn't want to debug.

## Caveats

- **Output format is Atlassian-controlled.** The table column separator is `│` (a box-drawing character, not pipe `|`). If Atlassian changes the format, the parser silently skips all rows and reports 0 installs everywhere — that's the symptom to watch for. If you see it, run the bare `forge install list` to inspect the new format.
- **Snapshots are per-machine.** Stored under `~/.claude/cache/forge-installs/` — so if you run on a different laptop or after a reset, deltas restart from "no baseline yet". This is intentional (avoids syncing personal cache across machines), but worth knowing if you ever wonder why a delta unexpectedly resets.
- **Snapshots accumulate.** One file per run. After months of regular use this is still tiny (~4KB per variant per run), but you can safely clean old files with `find ~/.claude/cache/forge-installs -name '*.tsv' -mtime +30 -delete`.
- **Long lists may time out.** The script uses `timeout=300` (5 min) on the subprocess. Bare `forge install list` ran ~30s for diagramly's 53 rows; lite at 906 rows could be slower. If you see "timeout — large variant", bump the value in the script.
- **Status column ("Up-to-date" vs "App update available") is informational only.** A site with `App update available` just hasn't auto-upgraded yet — not a broken state. Don't flag unless many installs are in that state.
