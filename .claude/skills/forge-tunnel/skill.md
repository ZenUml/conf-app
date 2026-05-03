---
name: forge-tunnel
description: >
  Run a Forge tunnel to test local code changes on a live Confluence instance.
  Use when the user wants to test a Forge app locally, run forge tunnel, debug
  a Forge app on a live site, or verify manifest/config changes before deploying.
  Triggers on "forge tunnel", "tunnel to confluence", "test locally on confluence",
  "run tunnel", "test on diagramly", "test on lite-stg", or any request to proxy
  local Forge app code to a live Atlassian site.
model: haiku
---

# Forge Tunnel

Run `forge tunnel` to proxy a live Confluence site to your local code. This lets you test manifest changes, new features, and bug fixes without deploying to staging/production.

## Happy path (everything already configured)

```bash
pnpm build:lite           # build the variant you care about
pnpm forge:deploy:dev     # uploads dist/ + manifest to your dev env
pnpm forge:upgrade:dev    # upgrades the install on your test site
pnpm forge:tunnel         # starts the tunnel — leave running
```

Open the test site in a browser. Done.

If `forge:upgrade:dev` errors with "Could not find an installation", the app isn't installed yet — see [First-time install](#first-time-install) below.

If `forge:deploy:dev` succeeds but `forge:upgrade:dev` errors with "scopes differ", just retry once — the deploy needs to settle.

## Key constraints

- **Tunnel only works with DEVELOPMENT environments** — `-e staging` and `-e production` fail with "Cannot create tunnels outside of the development environment".
- **`./scripts/forgex` is the canonical entry point** — it loads `.env.forge` + `.env.forge.local` and substitutes `{{VAR}}` placeholders. All `pnpm forge:*:dev` scripts use it. Don't call `forge` directly unless you're passing every env var inline.
- **`forge install` (fresh, no `--upgrade`) requires a real TTY** for the scope-confirmation prompt. Run with `!` so it executes in the user's terminal.
- **`forge deploy` packages whatever is in `dist/`** — always build before deploy.

## Setup (one-time per worktree)

Each worktree has its own `.env.forge` symlink and `.env.forge.local` (both are gitignored). When `using-git-worktrees` creates a new worktree, redo these steps.

### 1. Set active variant

```bash
ln -sf .env.forge.lite .env.forge    # or .env.forge.full / .env.forge.dia
```

### 2. Create personal env file

```bash
cp .env.forge.local.example .env.forge.local
```

Edit `.env.forge.local`:
```
FORGE_ENV=<your-dev-env-name>
ATLASSIAN_SITE=<your-test-site>.atlassian.net
```

To discover yours, run `forge environments list` (lists dev environments deployed for the app) and `forge install list -e <env>` (shows which sites have it installed). Pick a `(env, site)` pair where the env is deployed AND the site has it installed — or be prepared to fresh-install on a site where you have admin rights.

## Step-by-step

### 1. Build the variant

```bash
pnpm build:lite     # or build:full, build:diagramly
```

`forge deploy` packages `dist/` — if you skip this, you'll deploy stale assets.

### 2. Deploy to the dev environment

```bash
pnpm forge:deploy:dev
```

Run this whenever the manifest changed, or you're not sure. Code-only changes don't strictly need a redeploy (the tunnel serves local files), but the manifest must match what the install expects.

### 3. Install or upgrade on the Confluence site

Default path:
```bash
pnpm forge:upgrade:dev
```

#### First-time install

If upgrade errors "Could not find an installation", the app isn't on that site yet. Fresh install needs a TTY (no `--non-interactive` flag, no `--upgrade`):

```bash
! ./scripts/forgex install --site {{ATLASSIAN_SITE}} --product confluence -e {{FORGE_ENV}}
```

> Use the `{{VAR}}` template form, not `$VAR`. forgex substitutes `{{VAR}}` from `.env.forge.local` internally; `$VAR` is shell-expanded *before* forgex runs and is empty unless you've exported the var in your shell.

The `!` runs it in the user's terminal. Forge will print the scope list and prompt for confirmation — press Enter/Y to accept.

### 4. Start the tunnel

```bash
pnpm forge:tunnel
```

The tunnel is long-lived. If Claude is running it: use `run_in_background: true` and tail the output for `Listening for requests on local port XXXXX...`. If a human is running it: use a dedicated terminal tab and leave it open while testing.

To stop: Ctrl+C, or `kill <pid>` for a backgrounded one. No server-side cleanup needed.

### 5. Verify the tunnel is hitting your code

Open the test site in a browser. If this is a fresh install, you may need to insert a macro on a page first — go to a Confluence page → `/zenuml`, `/mermaid`, `/graph`, or `/openapi` → pick the macro. The macro then renders inside a Forge iframe served by your tunnel.

Once the macro renders:

- The tunnel terminal should print incoming proxied requests as the iframe loads. No requests = the tunnel isn't connected (wrong env, wrong site, or app not installed there — `forge install list -e <env>` to verify).
- If you don't see your code changes, hard-refresh (Cmd+Shift+R) — Confluence aggressively caches macro assets.
- If still stale, check that you're logged in as the same user the tunnel is associated with. The tunnel only intercepts YOUR authenticated session.

### During development

Frontend changes (`src/`, `dist/`):
```bash
pnpm build:<variant>      # rebuild
# tunnel auto-serves the new dist/ — no restart needed for asset changes
```

Backend changes (`functions/`): the tunnel auto-detects and reloads.

`manifest.yml` changes: full cycle — `forge deploy` + `forge install --upgrade` + tunnel restart.

## Apps and env files

| App | APP_ID | `.env.forge` symlink target |
|-----|--------|-----------------------------|
| Lite | `8ad26115-211f-4216-971b-0540f606303d` | `.env.forge.lite` |
| Full | `d9e4002b-120b-426b-834b-402a4a5adce7` | `.env.forge.full` |
| Diagramly | `01ede8b1-4e88-451a-b9ef-89eeef93afaf` | `.env.forge.dia` |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Cannot create tunnels outside of the development environment" | Using `-e staging` / `-e production` | Use a development env name |
| "The scopes or egress URLs differ from most recent deployment" | Manifest changed since last deploy to this env | Run `pnpm forge:deploy:dev` first |
| "Could not find an installation" on `--upgrade` | App not installed on that site yet | Fresh install path (`! ./scripts/forgex install ...`) |
| "Prompts can not be meaningfully rendered in non-TTY environments" | Fresh install needs TTY | Run with `!` prefix in user's terminal |
| "Insufficient permissions to install app" | Forge CLI can't auto-consent in headless mode, OR your user isn't admin on that site | Use interactive `!` install; if still fails, you need site-admin on that site (use a different env/site) |
| Tunnel listening but no incoming requests when you load the page | Wrong env, wrong site, or app not installed there | `forge install list -e <env>` to verify |
| Macros show old description/title | Confluence cached the old assets | Hard-refresh (Cmd+Shift+R) |
| Forge appends "(Development)" to macro names | Normal for dev environments | Won't appear in staging/production |
| Lint warnings about deprecated egress | Old permission format in manifest.yml | Safe to ignore; tunnel still starts |

## Tips

- The tunnel terminal output is the canonical signal that it's working — keep an eye on it
- `forge install list -e <env>` answers "which sites have this version installed"
- The tunnel only proxies your authenticated session — share-tested features need a real deploy
