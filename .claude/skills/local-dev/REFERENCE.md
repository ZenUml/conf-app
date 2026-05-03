# Local Dev Reference

## Tunnel Hostnames

| Developer | Tunnel Name | Hostname              |
|-----------|-------------|-----------------------|
| Peng      | peng        | 8080.diagramly.net    |
| Yanhui    | yanhui      | yanhui8080.zenuml.com |

## Forge App Configurations

| Variant   | App ID                                 | Connect Key                        |
|-----------|----------------------------------------|------------------------------------|
| Full      | `d9e4002b-120b-426b-834b-402a4a5adce7` | `com.zenuml.confluence-addon`      |
| Lite      | `8ad26115-211f-4216-971b-0540f606303d` | `com.zenuml.confluence-addon-lite` |
| Diagramly | `01ede8b1-4e88-451a-b9ef-89eeef93afaf` | `gptdock-confluence`               |

Switch with: `pnpm forge:use full|lite|dia`

## Vite Allowed Hosts

Configured in `vite.config.mjs` `server.allowedHosts`:
- `yanhui8080.zenuml.com`
- `8080.diagramly.net`
- `precise-oriented-mink.ngrok-free.app`
- `special-lemming-radically.ngrok-free.app`

Add new tunnel hostnames here if needed.

## Architecture

```
Browser (Confluence page)
  └─ iframe → https://8080.diagramly.net/sequence-viewer.html
                   │
                   ▼
          Cloudflare Tunnel (peng)
                   │
                   ▼
          localhost:8080 (Vite dev server, HMR)
                   │
                   ├─ Static files → served directly with HMR
                   └─ API routes → proxied to localhost:8788 (Wrangler)
                                        │
                                        ├─ /descriptor → Connect app descriptor
                                        ├─ /installed, /uninstalled → lifecycle
                                        ├─ /custom-content/* → CRUD
                                        ├─ /attachment → file handling
                                        └─ D1 database (local SQLite)
```

## Troubleshooting

### `connect.install.error.caas.override`
A Forge app with the same Connect key is installed. Uninstall it first (see Step 5).

### `upm.pluginInstall.error.ssl`
Re-install the app. Usually transient.

### `connect.install.error.remote.host.bad.response.401`
Restart the local server. Transient auth issue.

### Vite `403 - host not allowed`
Add the tunnel hostname to `vite.config.mjs` `server.allowedHosts`.

### Port already in use
```bash
lsof -i :8080  # Find the process
kill <PID>     # Stop it
```
