# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a ZenUML Confluence Cloud Add-on (Forge app) that provides diagramming capabilities for Confluence users. The add-on supports three main diagram types:
- **Sequence Diagrams** (ZenUML & Mermaid)
- **Graph Diagrams** (powered by DrawIO)
- **OpenAPI/Swagger Specifications**

The project is built as a full-stack application with:
- **Frontend**: Vue 3 with TypeScript, Vite build system, Forge Custom UI
- **Backend**: Cloudflare Workers with D1 database (accessed via Forge remotes)
- **Deployment**: Cloudflare Pages + Forge CLI
- **Platform**: Atlassian Forge (Connect runtime was removed; `app.connect` migration bridge in manifest.yml is kept for backward compatibility)

## Pure Forge — no Connect code

All three variants (lite, full, diagramly) are **Forge-only** in production. The Connect runtime is fully removed.

**Policy for all code changes:**
- Remove any Connect-era code when you encounter it. This includes: `xdm_e` / `xdm_c` URL parameter reads, the `AP.*` global, Connect-only host whitelists (e.g. `conf-full.zenuml.com`, `conf-lite.zenuml.com`), and helpers that assume a Connect iframe context.
- **`AP.*` and `window.AP.*` are forbidden in `src/`** (excluding `manifest.yml`). They will be `undefined` at runtime in pure Forge — defensive optional chaining (`window.AP?.x()`) just makes the code silently no-op. Use the equivalent `@forge/bridge` API: for `AP.resize`, no replacement is needed — Forge Custom UI iframes are auto-sized by the runtime; just delete the call. For the rest: `view.submit()` for `AP.dialog.close()`, `router.navigate()` for `AP.navigator.go()`, `requestConfluence()` for `AP.request()`, `view.getContext()` for `AP.context.getContext()`.
- For prod/staging detection, use `forgeGlobal.forgeContext?.environmentType` — not `window.location.host`. The Forge iframe is served from `*.cdn.prod.atlassian-dev.net/<app-id>/…`, not from the conf-*.zenuml.com hosts.
- For client-domain extraction, use `getClientDomain()` from `src/utils/ContextParameters/ContextParameters.ts`. Do not reimplement a Connect-style `getAtlassianDomain()` that relies on `xdm_e`.
- For variant-specific backend hostnames, use `forgeGlobal.zenumlRemoteBaseUrl` (derived from build variant + environment type) rather than hardcoding. **Exception:** DrawIO assets (`https://conf-full.zenuml.com/drawio/...`) are intentionally hosted on `conf-full.zenuml.com` and shared across all variants — keep those URLs as-is.

**Only exception:** `manifest.yml` must keep the `app.connect` / Connect key / modules entries — Atlassian's Forge-from-Connect migration requires these to stay so that upgrade paths from legacy Connect installs still work. Don't remove those.

## Development Commands

### Building and Testing
```bash
# Build full version
pnpm build:full

# Build lite version
pnpm build:lite

# Run unit tests
pnpm test:unit

# Run E2E tests
pnpm test:e2e
```

### Development Server
```bash
# Start local development (frontend only)
pnpm start:local

# Start full development environment (frontend + backend proxy)
pnpm start:sit

# Serve built files via Wrangler
pnpm wrangler:serve
```

### Forge Deployment
```bash
# Deploy to Forge staging
pnpm forge:deploy:lite:staging
pnpm forge:deploy:full:prod

# Forge tunnel for local development
pnpm forge:tunnel
```

### Linting
```bash
# Run Vue linting
pnpm lint:vue
```

## Architecture Overview

### Frontend Structure
- **Entry Point**: Single Forge Custom UI entry (`index.html` + `src/forgeIndex.ts`)
- **Forge Entry Points**: `src/forge-*.ts` files for different diagram types
- **Core Components**:
  - `Workspace.vue` - Main editor interface with split layout
  - `Editor/Editor.vue` - Code editor with syntax highlighting
  - `DiagramPortal.vue` - Diagram rendering portal
  - `Header/Header.vue` - Navigation and actions
  - `Viewer/` - Different viewers for each diagram type
- **Forge Integration**: `@forge/bridge` for Confluence API access (`requestConfluence`, `invokeRemote`, `view`, `router`)

### Backend Structure (Cloudflare Workers)
- **Functions**: Located in `functions/` directory. **CRITICAL:** `public/_routes.json` is an explicit allowlist — any new function path must be added to its `include` array, otherwise Cloudflare Pages serves the path as a static SPA HTML fallback instead of routing it to the function. Symptom: `GET /your/path` returns 200 with `content-type: text/html` instead of running your code.
- **Database**: D1 database with migrations in `functions/migrations/`
- **Auth**: Forge invocation token (RS256) validated via `functions/utils/authenticate.ts`
- **Key Endpoints**:
  - `/forge-custom-content` - Custom content management (Forge OAuth)
  - `/forge-installed` - Forge install/upgrade lifecycle handler
  - `/forge-user-behavior` - Forge trigger event handler
  - `/diagram-likes/` - Diagram like/unlike functionality
  - `/attachment` - File attachment handling
  - `/api/space-status` - License/payment status check

### Content Management
The app uses custom content (V2 API) for diagram persistence:
- **CustomContentStorageProvider** - Stores data as Confluence custom content
- **CompositeContentProvider** - Combines multiple providers with fallback chain

### Key Models
- **Diagram** - Core diagram model with content and metadata
- **ContentProvider** - Abstract interface for data persistence
- **ApWrapper2** - Forge API wrapper for Confluence operations
- **forgeGlobal** - Runtime context (`@forge/bridge` view, context, environment detection)

## Product Variants

The add-on comes in three variants:
- **Full Version** (`PRODUCT_TYPE=full`) - All features enabled
- **Lite Version** (`PRODUCT_TYPE=lite`) - Reduced feature set (free)
- **Diagramly** (`PRODUCT_TYPE=diagramly`) - Diagramly-branded variant

## Cloudflare Pages projects

Each variant maps to a specific Cloudflare Pages project. Use these exact names with `wrangler pages secret put`, `wrangler pages deployment tail`, etc.

| Variant | Staging project | Production project | Public hostname (prod) |
|---------|-----------------|--------------------|------------------------|
| Lite | `conf-stg-lite` | `conf-lite` | `conf-lite.zenuml.com` |
| Full | `conf-stg-full` | `conf-full` | `conf-full.zenuml.com` |
| Diagramly | `conf-stg-lite` (shared) | `conf-lite` (shared) | (served from lite) |

Sources: `.github/workflows/build-test-deploy.yml` (staging), `.github/workflows/release.yml` (prod). The wrangler config (`wrangler.toml`) has a placeholder `name="confluence-plugin"` that the CI replaces at deploy time via `sed` in `.github/actions/wrangler-publish/action.yml`.

**Setting a Pages secret** (e.g. `STRIPE_WEBHOOK_SECRET`):
```bash
# Staging
wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=conf-stg-lite
# Production
wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=conf-lite
```

Pipe the secret via `printf '...' | npx wrangler pages secret put ...` so the value never appears in shell history or `ps`.

## Stripe webhook (`/api/stripe-webhook`)

Auto-activates a space license in `SPACE_LICENSE_KV` when Stripe fires `checkout.session.completed`. Handler at `functions/api/stripe-webhook.ts`. The `STRIPE_WEBHOOK_SECRET` and `SPACE_LICENSE_KV` bindings are mandatory — without either, the function returns `500 server_configuration`.

**Stripe-side configuration** (Test and Live webhooks are separate):

| Stripe mode | Endpoint URL | Cloudflare project for the secret |
|-------------|--------------|----------------------------------|
| Test | `https://conf-stg-lite.pages.dev/api/stripe-webhook` | `conf-stg-lite` |
| Live | `https://conf-lite.zenuml.com/api/stripe-webhook` | `conf-lite` |

Required event: `checkout.session.completed`. The Stripe Checkout session must include `cloudId` and `spaceKey` in `session.metadata` — without them the webhook returns `400 missing_metadata` and no license is activated.

**Smoke test (no Stripe needed)** — confirms the function is deployed, the route allowlist (`public/_routes.json`) routes it through Pages Functions, and the secret + KV bindings are set:

```bash
curl -i -X POST "https://conf-stg-lite.pages.dev/api/stripe-webhook" \
  -H "Content-Type: application/json" -d '{}'
# Expected: HTTP 400  {"error":"missing_signature"}
# Got 500 server_configuration → secret or KV binding missing
# Got 405 with empty body → route not in _routes.json (function not invoked)
# Got 200 text/html → function not deployed at all (SPA fallback)
```

Verify a license record landed after a real Stripe event:

```bash
# Find the SPACE_LICENSE_KV namespace ID in wrangler.toml
npx wrangler kv key get --namespace-id <SPACE_LICENSE_KV_ID> --remote \
  "license:<cloudId>:<spaceKey>"
```

## Environment Configuration

### Local Development
1. Copy `wrangler-dev.toml` to `wrangler.toml`
2. Set up D1 database bindings
3. Configure environment variables in `wrangler.toml`

### Database Setup
```bash
# Create D1 database
wrangler d1 create zenuml-for-confluence

# Run migrations
wrangler d1 migrations apply zenuml-for-confluence --remote
```

## Git Workflow

**Never commit directly to `master`** unless explicitly told to. Always create a feature branch for new work:

```bash
git checkout -b <branch-name>
# ... make changes ...
git push origin <branch-name>
# then open a PR
```

The only exception is trivial config/doc changes when the user explicitly says to push to master.

## Browser Automation and Forge Iframes

Forge Custom UI apps render inside **sandboxed cross-origin iframes** (OOPIFs). Only Playwright can reliably access content inside them.

| Tool | Forge iframe access | Notes |
|------|---------------------|-------|
| **Playwright** | ✅ Yes | Use `frameLocator()` |
| **chrome-devtools-mcp** | ❌ No | Feature not implemented ([issue #703](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/703)) |
| **browser-use** | ❌ No | `cross_origin_iframes` flag exists but fix was reverted |
| **agent-browser** | ❌ No | Built on browser-use, same limitation |
| **claude-in-chrome** | ❌ No | Cannot cross origin iframe boundary |

Always use Playwright for E2E tests that interact with Forge app UI.

## E2E Test Principles

### Fail Fast
E2E tests must fail immediately with a clear error when a precondition is not met — never wait out a timeout. Specifically:

- **Macro not found**: After searching the macro browser, check `option.count()` immediately. If 0, throw with the macro name, appLabel, search term, and the list of available options. Do NOT let `locator.click()` wait 60 seconds before timing out.
- **General principle**: Any assertion about UI state should use an explicit check + immediate throw rather than relying on Playwright's implicit timeout as the failure mechanism.

This prevents slow CI feedback (a single missing macro caused 6 × 60s = ~6 min of wasted waiting across parallel tests).

## Integration Testing

1. Run `pnpm start:sit` to start both frontend and backend
2. Use `pnpm forge:tunnel` to expose via Forge tunnel
3. Test functionality in a Confluence instance

## Key Dependencies

- **@zenuml/core** - Core ZenUML rendering engine
- **@forge/bridge** - Forge Custom UI bridge (requestConfluence, invokeRemote, view)
- **@forge/api** - Forge API runtime
- **mermaid** - Mermaid diagram rendering
- **swagger-ui** - OpenAPI/Swagger rendering
- **codemirror** - Code editor functionality
- **vue** - Frontend framework
- **@sentry/cloudflare** - Error tracking
- **jose** - JWT verification (Forge invocation tokens)

## Analytics & Observability

### Event storage

| Event | Storage | Purpose |
|-------|---------|---------|
| `page_viewed`, `page_updated` | D1 `UserBehaviorEvent` (full hostname as `clientDomain`, e.g. `linemanwongnai.atlassian.net`) | Tenant activity signal — fires for any Confluence page with the macro installed, NOT specific to macro views |
| `view_macro` | Mixpanel only | Actual macro view counts; use for paywall/engagement analysis |
| Install/uninstall lifecycle | R2 `atlassian-events` bucket (`{domain}/lifecycle/{isoDate}.json`) | Forge install events |

> Mixpanel tracking for `page_viewed`/`page_updated` is intentionally commented out in `functions/forge-user-behavior.ts:62`.

### Interpreting `page_viewed` in D1

`page_viewed` fires whenever a user views any Confluence page on a site where our macro is installed. It does **not** mean the user viewed one of our macros. Use it to determine whether a **tenant is active on Confluence** (i.e., people are using the product at all). For macro-specific engagement, use Mixpanel `view_macro`.

### Key analytics sources

- **D1 `conf-zenuml-prod`** — tenant activity (`UserBehaviorEvent`), install records (`ForgeInstallation`, `ClientInstallation`), content data
- **Mixpanel** — macro view counts (`view_macro`), filtered by `client_domain` property
- **KV metrics-inspect** — macro counts per space: `https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<subdomain>`

### clientDomain format mismatch

KV flags use the **subdomain prefix** (`linemanwongnai`) but D1 `UserBehaviorEvent` stores the **full hostname** (`linemanwongnai.atlassian.net`). Always use full hostname when querying D1.

## File Structure Notes

- `src/` - Frontend source code
- `functions/` - Cloudflare Workers backend
- `public/` - Static assets and DrawIO integration
- `manifest.yml` - Forge app manifest
- `tests/` - Unit and E2E tests
- `docs/` - Project documentation
