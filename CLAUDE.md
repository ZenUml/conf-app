# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project orientation

### Domain terminology

- **edits** — new versions of existing macro custom content (updating an existing diagram)
- **creates** — new macro custom content (saving a diagram for the first time)
- **D1** — Cloudflare D1 database (SQLite-compatible, used for backend storage)
- **pw** — Playwright (E2E test runner)
- **client** / **tenant** — interchangeable; both refer to a Confluence Cloud site (one Atlassian instance that has installed the add-on)
- **spot check** — ad hoc, AI-driven, ephemeral verification of a specific behavior; use the **spot-check** skill

### Project overview

This is a ZenUML Confluence Cloud Add-on (Forge app) that provides diagramming capabilities for Confluence users. The `DiagramType` enum (`src/model/Diagram/Diagram.ts`) defines five first-class diagram types:

- **Sequence** — ZenUML sequence diagrams (the namesake renderer)
- **Mermaid** — multi-purpose Mermaid renderer
- **PlantUml** — multi-purpose PlantUML renderer
- **Graph** — DrawIO-powered graph diagrams
- **OpenApi** — OpenAPI/Swagger specifications via swagger-ui

The project is built as a full-stack application with:

- **Frontend**: Vue 3 with TypeScript, Vite build system, Forge Custom UI
- **Backend**: Cloudflare Workers with D1 database (accessed via Forge remotes)
- **Deployment**: Cloudflare Pages + Forge CLI
- **Platform**: Atlassian Forge (Connect runtime was removed; `app.connect` migration bridge in manifest.yml is kept for backward compatibility)

### Product variants

The add-on comes in three variants:

- **Full Version** (`PRODUCT_TYPE=full`) — All features enabled
- **Lite Version** (`PRODUCT_TYPE=lite`) — Reduced feature set (free)
- **Diagramly** (`PRODUCT_TYPE=diagramly`) — Diagramly-branded variant

## Hard rules

### Pure Forge — no Connect code

All three variants (lite, full, diagramly) are **Forge-only** in production. The Connect runtime is fully removed.

**Only exception:** `manifest.yml` must keep the `app.connect` / Connect key / modules entries — Atlassian's Forge-from-Connect migration requires these to stay so that upgrade paths from legacy Connect installs still work. Don't remove those.

For the full policy — banned APIs (`AP.*`, `xdm_e`, Connect hosts), `@forge/bridge` replacements, environment detection, DrawIO URL rules — see `docs/policies/forge-only.md` (create if absent when you need to capture a new decision).

### Client privacy — no client names in public files

Real Confluence tenant names (subdomain prefixes, `<customer>.atlassian.net` hostnames, customer page titles, customer `cloudId`s) **MUST NOT** appear in any public-repo file. Use placeholders (`example-tenant`, `example.atlassian.net`). Real tenant data lives in the `private/` submodule (`ZenUml/conf-app-private`).

Full rules, artifact routing table, pre-commit grep, and background: [docs/policies/client-privacy.md](docs/policies/client-privacy.md).

### Never commit directly to `main`

Always use a feature branch. Exception: `.md`-only changes may go directly to `main`.

Branching protocol (start-of-issue steps, worktree usage): [docs/policies/git-workflow.md](docs/policies/git-workflow.md).

### Never disrupt another session's working tree

If `git status` shows uncommitted changes you didn't make, **do not** `git checkout`, `git reset --hard`, `git restore`, `git clean`, or `git stash` those changes — all of these either destroy or displace in-flight work from another session.

Instead, create a new branch from `main` using a worktree:

```bash
git worktree add ../conf-app-<your-feature> -b <your-feature-branch> main
```

The original directory stays untouched. When in doubt, ask before any destructive git operation.

## Architecture

### Frontend

- **Entry Point**: Single Forge Custom UI entry (`index.html` + `src/forgeIndex.ts`)
- **Forge Entry Points**: `src/forge-*.ts` files for different diagram types
- **Core Components**:
  - `Workspace.vue` — Main editor interface with split layout
  - `Editor/Editor.vue` — Code editor with syntax highlighting
  - `DiagramPortal.vue` — Diagram rendering portal
  - `Header/Header.vue` — Navigation and actions
  - `Viewer/` — Different viewers for each diagram type
- **Forge Integration**: `@forge/bridge` for Confluence API access (`requestConfluence`, `invokeRemote`, `view`, `router`)

### Backend (Cloudflare Workers)

- **Functions**: Located in `functions/` directory. **CRITICAL:** `public/_routes.json` is an explicit allowlist — any new function path must be added to its `include` array, otherwise Cloudflare Pages serves the path as a static SPA HTML fallback instead of routing it to the function. Symptom: `GET /your/path` returns 200 with `content-type: text/html` instead of running your code.
- **Database**: D1 database with migrations in `functions/migrations/`
- **Auth**: Forge invocation token (RS256) validated via `functions/utils/authenticate.ts`
- **Key Endpoints**:
  - `/forge-custom-content` — Custom content management (Forge OAuth)
  - `/forge-installed` — Forge install/upgrade lifecycle handler
  - `/forge-user-behavior` — Forge trigger event handler
  - `/diagram-likes/` — Diagram like/unlike functionality
  - `/attachment` — File attachment handling
  - `/api/space-status` — License/payment status check

### Content management

The app uses custom content (V2 API) for diagram persistence:

- **CustomContentStorageProvider** — Stores data as Confluence custom content
- **CompositeContentProvider** — Combines multiple providers with fallback chain

### Key models

- **Diagram** — Core diagram model with content and metadata
- **ContentProvider** — Abstract interface for data persistence
- **ApWrapper2** — Forge API wrapper for Confluence operations
- **forgeGlobal** — Runtime context (`@forge/bridge` view, context, environment detection)

## Local development

### Initial setup

1. Copy `wrangler-dev.toml` to `wrangler.toml`
2. Set up D1 database bindings
3. Configure environment variables in `wrangler.toml`

### Build & test

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

### Dev server

```bash
# Start local development (frontend only)
pnpm start:local

# Start full development environment (frontend + backend proxy)
pnpm start:sit

# Serve built files via Wrangler
pnpm wrangler:serve
```

### Database setup

```bash
# Create D1 database
wrangler d1 create zenuml-for-confluence

# Run migrations
wrangler d1 migrations apply zenuml-for-confluence --remote
```

## Operations

### Forge deployment

```bash
# Deploy to Forge staging
pnpm forge:deploy:lite:staging
pnpm forge:deploy:full:prod

# Forge tunnel for local development
pnpm forge:tunnel
```

#### Forge CLI auth

If `forge whoami` says not logged in (or `forge login` fails on keychain), see [docs/debugging/forge-cli-auth.md](docs/debugging/forge-cli-auth.md). Common in IDE/non-TTY shells: rebuild `keytar`, unlock macOS keychain, re-login from Terminal.app, or use `FORGE_EMAIL` / `FORGE_API_TOKEN`.

### Cloudflare Pages projects

Lite / full / diagramly map to `conf-stg-lite`, `conf-stg-full`, `conf-lite`, `conf-full`. See [docs/ops/cloudflare-pages.md](docs/ops/cloudflare-pages.md) for the full table, CI sources, and `wrangler pages secret put` usage.

### Analytics & observability

Key gotcha: `page_viewed` in D1 signals tenant activity on Confluence — **not** a macro view. Use Mixpanel `macro_viewed` (project ID `3373228`) for macro engagement.

Full reference (event storage, `clientDomain` format, key sources, paywall events): [docs/analytics-reference.md](docs/analytics-reference.md). For query patterns, use the **conf-app** skill.

## Browser automation and Forge iframes

Forge Custom UI apps render inside **sandboxed cross-origin iframes** (OOPIFs). Only Playwright can reliably access content inside them.

| Tool | Forge iframe access | Notes |
|---|---|---|
| **Playwright** | ✅ Yes | Use `frameLocator()` |
| **chrome-devtools-mcp** | ❌ No | Feature not implemented ([issue #703](https://github.com/ChromeDevTools/chrome-devtools-mcp/issues/703)) |
| **browser-use** | ❌ No | `cross_origin_iframes` flag exists but fix was reverted |
| **agent-browser** | ❌ No | Built on browser-use, same limitation |
| **claude-in-chrome** | ❌ No | Cannot cross origin iframe boundary |

Always use Playwright for E2E tests that interact with Forge app UI.

## Agent skills

- **spot-check** — ad hoc verification of a specific behavior (not a checked-in E2E test). Triggers: "spot check on staging", "verify this fix". Forge iframe rules in [Browser automation and Forge iframes](#browser-automation-and-forge-iframes).
- **Issue tracker** — issues live as GitHub issues on `ZenUml/conf-app`; use the `gh` CLI for all operations.
- **Triage labels** — five canonical roles, names verbatim: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`.
- **Domain docs** — single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by `/grill-with-docs` as terms and decisions crystallise). **Read `CONTEXT.md` at the start of any session involving Cloudflare tooling, KV, D1, analytics, or feature flags** — it contains tooling gotchas that override apparent CLI output.
