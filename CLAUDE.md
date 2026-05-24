# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Domain Terminology

- **edits** — new versions of existing macro custom content (updating an existing diagram)
- **creates** — new macro custom content (saving a diagram for the first time)
- **D1** — Cloudflare D1 database (SQLite-compatible, used for backend storage)
- **pw** — Playwright (E2E test runner)
- **client** / **tenant** — interchangeable; both refer to a Confluence Cloud site (one Atlassian instance that has installed the add-on)
- **spot check** — ad hoc, AI-driven, ephemeral verification of a specific behavior; use the **spot-check** skill

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

**Only exception:** `manifest.yml` must keep the `app.connect` / Connect key / modules entries — Atlassian's Forge-from-Connect migration requires these to stay so that upgrade paths from legacy Connect installs still work. Don't remove those.

For the full policy — banned APIs (`AP.`*, `xdm_e`, Connect hosts), `@forge/bridge` replacements, environment detection, DrawIO URL rules — see `docs/policies/forge-only.md` (create if absent when you need to capture a new decision).

## Client privacy — no client names in public files

**Policy:** Real Confluence tenant names (subdomain prefixes, `<customer>.atlassian.net` hostnames, customer page titles, customer `cloudId`s) **MUST NOT** appear in any public-repo file. Use placeholders (`example-tenant`, `example.atlassian.net`). Real tenant data lives in the `private/` submodule (`ZenUml/conf-app-private`).

Full rules, artifact routing table, pre-commit grep, and background: [docs/policies/client-privacy.md](docs/policies/client-privacy.md).

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

#### Forge CLI auth

If `forge whoami` says not logged in (or `forge login` fails on keychain), see [docs/debugging/forge-cli-auth.md](docs/debugging/forge-cli-auth.md). Common in IDE/non-TTY shells: rebuild `keytar`, unlock macOS keychain, re-login from Terminal.app, or use `FORGE_EMAIL` / `FORGE_API_TOKEN`.

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

Lite / full / diagramly map to `conf-stg-lite`, `conf-stg-full`, `conf-lite`, `conf-full`. See [docs/ops/cloudflare-pages.md](docs/ops/cloudflare-pages.md) for the full table, CI sources, and `wrangler pages secret put` usage.

## Stripe webhook

`POST /api/stripe-webhook` activates space licenses on `checkout.session.completed`. See [docs/ops/stripe-webhook.md](docs/ops/stripe-webhook.md) for Stripe endpoint URLs, smoke test, and KV verification.

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

**Never commit directly to `main`** — always use a feature branch. Exception: `.md`-only changes may go directly to `main`.

For the branching protocol (start-of-issue steps, worktree usage): [docs/policies/git-workflow.md](docs/policies/git-workflow.md).

### Never disrupt another session's working tree

If `git status` shows uncommitted changes you didn't make, **do not** `git checkout`, `git reset --hard`, `git restore`, `git clean`, or `git stash` those changes — all of these either destroy or displace in-flight work from another session.

Instead, create a new branch from `main` using a worktree:

```bash
git worktree add ../conf-app-<your-feature> -b <your-feature-branch> main
```

The original directory stays untouched. When in doubt, ask before any destructive git operation.

## Browser Automation and Forge Iframes

Forge Custom UI apps render inside **sandboxed cross-origin iframes** (OOPIFs). Only Playwright can reliably access content inside them.


| Tool                    | Forge iframe access | Notes                                                                                                    |
| ----------------------- | ------------------- | -------------------------------------------------------------------------------------------------------- |
| **Playwright**          | ✅ Yes               | Use `frameLocator()`                                                                                     |
| **chrome-devtools-mcp** | ❌ No                | Feature not implemented ([issue #703](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/703)) |
| **browser-use**         | ❌ No                | `cross_origin_iframes` flag exists but fix was reverted                                                  |
| **agent-browser**       | ❌ No                | Built on browser-use, same limitation                                                                    |
| **claude-in-chrome**    | ❌ No                | Cannot cross origin iframe boundary                                                                      |


Always use Playwright for E2E tests that interact with Forge app UI.

## E2E Test Principles

### Fail Fast

E2E tests must fail immediately with a clear error when a precondition is not met — never wait out a timeout. Specifically:

- **Macro not found**: After searching the macro browser, check `option.count()` immediately. If 0, throw with the macro name, appLabel, search term, and the list of available options. Do NOT let `locator.click()` wait 60 seconds before timing out.
- **General principle**: Any assertion about UI state should use an explicit check + immediate throw rather than relying on Playwright's implicit timeout as the failure mechanism.

This prevents slow CI feedback (a single missing macro caused 6 × 60s = ~6 min of wasted waiting across parallel tests).

## Analytics & Observability

Key gotcha: `page_viewed` in D1 signals tenant activity on Confluence — **not** a macro view. Use Mixpanel `macro_viewed` (project ID `3373228`) for macro engagement.

Full reference (event storage, `clientDomain` format, key sources, paywall events): [docs/analytics-reference.md](docs/analytics-reference.md). For query patterns, use the **conf-app** skill.

## Agent skills

### Spot checks

Ad hoc verification of specific behavior — not a checked-in E2E test. Use the **spot-check** skill (triggers: "spot check on staging", "verify this fix", etc.). Forge iframe rules: [Browser Automation and Forge Iframes](#browser-automation-and-forge-iframes).

### Issue tracker

Issues live as GitHub issues on `ZenUml/conf-app` — use the `gh` CLI for all operations.

### Triage labels

Five canonical roles, names verbatim: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by `/grill-with-docs` as terms and decisions crystallise).