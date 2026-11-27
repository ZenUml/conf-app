# Production e-ink board

The Mac-rendered 1404×1872 reMarkable 2 dashboard, maintained as ordinary files in
Conf App's Git repository. This is a source snapshot, not a nested repository or a
submodule. No commits from the former `~/workspaces/ink-display` repository are imported.

## Scope

- `board/`: the running board server, section readers, Mixpanel billing sync,
  renderer, device pull/install scripts, launchd templates and existing tests.
- `kindle/frame_source.py` and `kindle/render.py`: dependencies of the board's
  token reader. The separate Kindle server, device packaging, jailbreak files,
  experiments, Git worktrees and agent state are deliberately not imported.
- Fixtures contain fictional customers. Runtime configuration, tokens, customer
  notes, billing snapshots, caches and logs stay outside this directory.

The initial snapshot uses the source files in the running board's checkout,
including its uncommitted runtime modules. Those runtime files predate the observed
server start on 23 November 2026. Tests and a deterministic fixture rendering are
checked in the destination before adoption; no behavior or layout change is intended.
The former repository, all its history, uncommitted files and associated worktrees
are left intact as the rollback/archive copy.

## Local checks

Python 3.14 and Pillow 13.0.0 match the existing Mac service environment.
From `ink-display/`, using the existing environment:

```sh
~/.local/share/kindle-quota/venv/bin/python -m unittest discover -s board -p 'test_*.py'
~/.local/share/kindle-quota/venv/bin/python board/preview.py /tmp/ink-board-preview.png
```

A separate environment can install `requirements.txt`. Tests inject external
data providers; they do not need production database or cloud writes.
The fixture preview is synthetic, not the live board or proof of device delivery.

## External runtime dependencies

The import does not copy these private files or external projects:

| Dependency | Location / purpose |
|---|---|
| Board configuration and private data | `~/.local/share/remarkable-board/` (including `config.json`, customer notes, billing snapshots and cache) |
| Existing Python environment and GCP credit snapshot | `~/.local/share/kindle-quota/`; credit data is still refreshed by the separate Kindle job |
| Quota provider environment and config | `~/.local/share/epaper-quota/` |
| Quota provider source | `~/workspaces/remarkable/esp32-quota-display/send_quota.py` |
| Marketplace / Mixpanel readers | Conf App's existing `.claude/skills/marketplace/scripts/mp_report.py` and `.claude/skills/mixpanel/scripts/mp_query.py` |
| Marketplace credentials | Conf App's `.env.forge.local` (never copy into this directory) |
| D1 query helper | `~/.claude/skills/conf-app/scripts/d1_query.sh` |
| Cloud command-line readers | Existing authenticated `gcloud` and `bq` |
| Mixpanel billing browser | Existing `agent-browser` and private `~/.agent-browser/profiles/mixpanel` profile |
| Tablet display runtime | Existing `/home/root/.local/share/remarkable-dashboard-runtime/` helpers and libraries; `device/install.sh` is not a fresh-device bootstrap |

The allowlist in `.gitignore` prevents accidental inclusion of local state.
Conf App's `.forgeignore` excludes this entire dashboard from Forge deployment.
This local dashboard does not change the Confluence UI or add analytics events.

## Production path and adoption

Intended source path after this change lands on Conf App's `main`:
`~/workspaces/zenuml/conf-app/ink-display/board`.
The two versioned launchd templates point to that path; they are not automatically
installed. Existing installed jobs still run from `~/workspaces/ink-display/board`.
Preparing this snapshot does not restart a service, install on the tablet, or
change the separate Kindle job.

After the snapshot lands, adoption requires replacing and reloading the board and
Mixpanel LaunchAgents with these templates, then checking `/board-id`, the served
PNG and section refreshes. Keep the current installed plists as rollback copies.
Do not remove the former checkout while the Kindle job or its worktrees use it.

See `board/DESIGN.md` for section contracts and `board/BILLING_SYNC.md` for the
existing billing ingestion workflow.
