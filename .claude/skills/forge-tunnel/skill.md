---
name: forge-tunnel
description: >
  Run a Forge tunnel to test local code changes on a live Confluence instance.
  Use when the user wants to test a Forge app locally, run forge tunnel, debug
  a Forge app on a live site, or verify manifest/config changes before deploying.
  Triggers on "forge tunnel", "tunnel to confluence", "test locally on confluence",
  "run tunnel", "test on diagramly", "test on lite-stg", or any request to proxy
  local Forge app code to a live Atlassian site.
---

# Forge Tunnel

Run `forge tunnel` to proxy a live Confluence site to your local code. This lets you test manifest changes, new features, and bug fixes without deploying to staging/production.

## Prerequisites

- Forge CLI installed (`npm install -g @forge/cli@latest`)
- Logged into Forge (`forge login`)
- App already built (`pnpm build:lite`, `pnpm build:diagramly`, or `pnpm build:full`)

## Key Constraints

- **Tunnel only works with DEVELOPMENT environments** — `forge tunnel -e staging` and `-e production` will fail with "Cannot create tunnels outside of the development environment"
- **Tunnel is a long-running process** — it must stay alive to proxy requests. Run it as a background task with a 10-minute timeout (`run_in_background: true, timeout: 600000`). If the tunnel needs to stay alive longer than 10 minutes, ask the user to run it in a separate terminal.
- **Must deploy + upgrade before first tunnel** — the development environment needs the latest manifest. Deploy first, then upgrade the installation, then tunnel.
- **Env vars must be passed inline** — tunnel doesn't read from `.env.forge` files; pass all variant-specific vars directly in the command.

## Apps and Environments

| App | APP_ID | Dev Env Names | Sites Installed |
|-----|--------|---------------|-----------------|
| Lite | `8ad26115-211f-4216-971b-0540f606303d` | (check with `forge environments list`) | lite-stg, zenuml-stg |
| Diagramly | `01ede8b1-4e88-451a-b9ef-89eeef93afaf` | `development`, `yanhui`, `peng-dev`, `true` | diagramly.atlassian.net (`development` env) |
| Full | `d9e4002b-120b-426b-834b-402a4a5adce7` | (check with `forge environments list`) | zenuml-stg, zenuml |

To check which environments exist and where the app is installed:
```bash
APP_ID=<app-id> forge environments list
APP_ID=<app-id> forge install list -e <env-name>
```

## Step-by-Step

### 1. Build the variant

```bash
pnpm build:diagramly   # or build:lite, build:full
```

### 2. Deploy to the development environment

```bash
# Diagramly example:
APP_ID=01ede8b1-4e88-451a-b9ef-89eeef93afaf \
CONNECT_KEY=gptdock-confluence \
SEQUENCE_MACRO_KEY=gpt-diagram-macro \
CUSTOM_CONTENT_KEY=gpt-custom-content-key \
LITE_KEY_SUFFIX= \
LITE_TITLE_SUFFIX= \
APP_LABEL='Diagramly for Confluence' \
BACKEND_API_BASE_URL=https://confluence-plugin.pages.dev \
forge deploy -e development --non-interactive
```

### 3. Upgrade the installation (if scopes/egress changed)

```bash
APP_ID=01ede8b1-4e88-451a-b9ef-89eeef93afaf \
forge install --upgrade --site diagramly.atlassian.net --product confluence -e development --non-interactive
```

### 4. Start the tunnel

Run as a background task with a 10-minute timeout:

```bash
APP_ID=01ede8b1-4e88-451a-b9ef-89eeef93afaf \
CONNECT_KEY=gptdock-confluence \
SEQUENCE_MACRO_KEY=gpt-diagram-macro \
CUSTOM_CONTENT_KEY=gpt-custom-content-key \
LITE_KEY_SUFFIX= \
LITE_TITLE_SUFFIX= \
APP_LABEL='Diagramly for Confluence' \
BACKEND_API_BASE_URL=https://confluence-plugin.pages.dev \
forge tunnel -e development
```

The tunnel will:
1. Run `forge lint` (warnings are OK, they don't block)
2. Bundle the code
3. Start listening on a local port
4. Proxy requests from the Confluence site to local code

### 5. Test in the browser

Open the target Confluence site in a browser where you're logged in. The tunnel only serves requests from YOUR user session — other users see the deployed version.

## Variant-Specific Env Vars

| Var | Lite (default) | Full | Diagramly |
|-----|---------------|------|-----------|
| `APP_ID` | `8ad26115-...` | `d9e4002b-...` | `01ede8b1-...` |
| `CONNECT_KEY` | `com.zenuml.confluence-addon-lite` | (not set) | `gptdock-confluence` |
| `SEQUENCE_MACRO_KEY` | `zenuml-sequence-macro-lite` | (not set) | `gpt-diagram-macro` |
| `CUSTOM_CONTENT_KEY` | `zenuml-content-sequence` | (not set) | `gpt-custom-content-key` |
| `LITE_KEY_SUFFIX` | `-lite` | (empty) | (empty) |
| `LITE_TITLE_SUFFIX` | `" Lite"` | (empty) | (empty) |
| `APP_LABEL` | `ZenUML for Confluence Lite` | `ZenUML for Confluence` | `Diagramly for Confluence` |
| `BACKEND_API_BASE_URL` | `https://conf-stg-lite.zenuml.com` | `https://confluence-plugin.pages.dev` | `https://confluence-plugin.pages.dev` |

## Troubleshooting

| Problem | Cause | Fix |
|---------|-------|-----|
| "Cannot create tunnels outside of the development environment" | Using `-e staging` or `-e production` | Use a development environment name |
| Tunnel exits immediately | Background task timeout too short | Use `timeout: 600000` (10 min max) with `run_in_background: true` |
| "App update available" in install list | Manifest changed since last deploy | Run `forge deploy` then `forge install --upgrade` |
| Macros show old description/title | Tunnel not connected or cache | Hard-refresh the Confluence page (Cmd+Shift+R) |
| Forge appends "(Development)" to macro names | Normal for dev environments | This won't appear in staging/production |
| Lint warnings about deprecated egress | Old permission format in manifest.yml | Safe to ignore; tunnel still starts after lint |

## Tips

- Forge tunnel output shows each incoming request — useful for debugging
- Changes to frontend code (in `dist/`) require rebuilding (`pnpm build:<variant>`) and restarting the tunnel
- Changes to `manifest.yml` require `forge deploy` + `forge install --upgrade` + tunnel restart
- The tunnel auto-detects code changes in `functions/` (backend) but NOT in `dist/` (frontend)
