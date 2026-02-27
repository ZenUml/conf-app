---
name: migration-check
description: Check Connect-to-Forge migration status across D1 database, Mixpanel analytics, and Forge CLI. Use when checking how many clients are on Connect vs Forge, identifying active connect-only clients, or auditing migration progress for Lite, Full, or Diagramly apps.
---

# Migration Status Check

Check Connect-to-Forge migration status by cross-referencing three data sources:
- **D1 database** — Connect installations (`ClientInstallation` table)
- **Forge CLI** — Forge installations (`forgex install list`)
- **Mixpanel** — Active clients (analytics events)

## App Configuration

| App | APP_ID | CONNECT_KEY | Env File | Mixpanel Filter |
|-----|--------|-------------|----------|-----------------|
| Lite | `8ad26115-211f-4216-971b-0540f606303d` | `com.zenuml.confluence-addon-lite` | `.env.forge.lite` | `addon_key == com.zenuml.confluence-addon-lite` on `view_macro` event |
| Full | `d9e4002b-120b-426b-834b-402a4a5adce7` | `com.zenuml.confluence-addon` | `.env.forge.full` | `addon_key == com.zenuml.confluence-addon` on `view_macro` event |
| Diagramly | `01ede8b1-4e88-451a-b9ef-89eeef93afaf` | `gptdock-confluence` | `.env.forge.dia` | `$current_domain == conf-gpt.zenuml.com` on `Pageview` event |

## Workflow

### Step 1: Get Forge Installations

Switch to the target app and list production installs. **Must use `forgex`** (not bare `forge`) to load the correct `APP_ID`:

```bash
pnpm forge:use <lite|full|dia>
./scripts/forgex install list -e production --json 2>/dev/null | python3 scripts/parse_forge_installs.py
```

Output: `forge_sites.txt` (one site per line)

### Step 2: Get Connect Installations from D1

Query the `ClientInstallation` table filtered by the app's `CONNECT_KEY`:

```bash
python3 scripts/query_d1_connect.py <CONNECT_KEY>
```

This runs:
```sql
SELECT clientDomain, pluginsVersion, eventType
FROM ClientInstallation WHERE key = '<CONNECT_KEY>'
```

Output: `connect_sites.txt` (one domain per line)

### Step 3: Get Active Clients from Mixpanel

Query Mixpanel for unique `client_domain` values. Credentials are in `.env.mixpanel`.

```bash
python3 scripts/query_mixpanel.py <lite|full|dia> <days>
```

- For **Lite/Full**: queries `view_macro` events filtered by `addon_key`
- For **Diagramly**: queries `Pageview` events filtered by `$current_domain == conf-gpt.zenuml.com`

Output: `mixpanel_active.txt` (one domain per line)

### Step 4: Cross-Reference

```bash
python3 scripts/cross_reference.py
```

Reads the three output files and produces a summary:

| Category | Description |
|----------|-------------|
| On Forge | In Forge install list |
| Connect only | In D1 but not in Forge |
| Active connect-only | In Mixpanel AND connect-only |
| Active on Forge | In Mixpanel AND on Forge |
| Ghost | In Mixpanel but not in D1 or Forge |

## Key Notes

- `forgex` loads `.env.forge` (symlink) + `.env.forge.local`, then runs `forge`. Bare `forge` uses the default app from `manifest.yml` (Lite).
- Mixpanel API secret is in `.env.mixpanel` (`API_Secret` field). Auth is `Basic base64(secret:)`.
- D1 config is in `wrangler-prod.toml` (database: `conf-zenuml-prod`, env: `production`).
- Mixpanel `client_domain` values do NOT include `.atlassian.net` — normalize when comparing.
- Diagramly has **no Connect installations in D1** (all Connect tracking goes through `conf-gpt.zenuml.com` without hitting our `/installed` webhook in the same way).
- Events from uninstalled sites can still appear in Mixpanel (cached macro pages fire tracking pixels).
