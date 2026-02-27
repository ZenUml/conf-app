---
name: local-dev
description: Start a local development server for the Connect app and install it on a Confluence site via UPM. Use when setting up local dev, tunneling to Confluence, or installing the Connect app on a test site.
disable-model-invocation: true
allowed-tools: Bash, Read, Grep, Glob
---

# Local Development for Connect App

Set up the local dev environment and install the Connect app on a Confluence site.

Target site: $ARGUMENTS (default: diagramly.atlassian.net)

## Step 1: Ensure wrangler.toml is linked

```bash
ls -la wrangler.toml
```

If not symlinked to `wrangler-dev.toml`, run `pnpm wrangler:link`.

## Step 2: Check ports are free

```bash
lsof -i :8080 -i :8788
```

Port 8080 = Vite (frontend), port 8788 = Wrangler (backend). If occupied, stop the existing process first.

## Step 3: Start the local server

```bash
pnpm start:sit
```

This runs:
1. `pnpm db:migrate:local` — D1 migrations locally
2. `pnpm wrangler:serve` — Wrangler on **port 8788** (backend functions + static)
3. `pnpm start:local` — Vite on **port 8080** (frontend with HMR)

Vite proxies backend routes (`/descriptor`, `/installed`, `/custom-content`, `/attachment`, etc.) to Wrangler. See `vite.config.mjs` `server.proxy`.

## Step 4: Expose via Cloudflare Tunnel

The `peng` tunnel routes `8080.diagramly.net` → `localhost:8080`. It should already be running. Verify:

```bash
curl -s https://8080.diagramly.net/descriptor | head -c 200
```

If not running, start it: `cloudflared tunnel run peng`

## Step 5: Uninstall conflicting Forge app (if needed)

A Connect app cannot be installed if a Forge app with the same key exists. If you hit `connect.install.error.caas.override`:

```bash
pnpm forge:use full    # or lite/dia
forge uninstall --site <site>.atlassian.net --product confluence -e <environment>
```

## Step 6: Install via UPM REST API

The old UPM UI is deprecated. Use the browser's authenticated session. Navigate to the site's UPM page, then execute via browser console or Playwright `browser_run_code`:

```javascript
// Get CSRF token
const tokenRes = await fetch('/wiki/rest/plugins/1.0/?os_authType=browser', { method: 'HEAD' });
const upmToken = tokenRes.headers.get('upm-token');

// Install
const res = await fetch('/wiki/rest/plugins/1.0/?token=' + upmToken, {
  method: 'POST',
  headers: { 'Content-Type': 'application/vnd.atl.plugins.remote.install+json' },
  body: JSON.stringify({ pluginUri: 'https://8080.diagramly.net/descriptor' })
});
const data = await res.json();

// Poll for completion (wait ~5s)
const taskRes = await fetch(data.links.self);
const result = await taskRes.json();
// result.done === true means success; result.error means failure
```

For lite: use `https://8080.diagramly.net/descriptor?lite`

## Step 7: Verify

Open a Confluence page with a ZenUML macro. Console logs should show requests to `8080.diagramly.net` instead of the production URL. Vite HMR means code changes reflect immediately.

## Reference

See [REFERENCE.md](REFERENCE.md) for tunnel hostnames, Forge app configs, and troubleshooting.
