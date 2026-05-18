# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Domain Terminology

- **edits** — new versions of existing macro custom content (updating an existing diagram)
- **creates** — new macro custom content (saving a diagram for the first time)
- **D1** — Cloudflare D1 database (SQLite-compatible, used for backend storage)
- **pw** — Playwright (E2E test runner)
- **client** / **tenant** — interchangeable; both refer to a Confluence Cloud site (one Atlassian instance that has installed the add-on)
- **spot check** — ad hoc, AI-driven, ephemeral verification of a specific behavior; see the [Spot Checks](#spot-checks) section for full definition

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
- For variant-specific backend hostnames, use `forgeGlobal.zenumlRemoteBaseUrl` (derived from build variant + environment type) rather than hardcoding.
- DrawIO assets (`public/drawio/`, ~155 MB) are bundled per-variant and loaded via **relative** URLs (`./drawio/index.html`, `./drawio/js/...`) so they resolve against the variant's own Forge CDN host (e.g. `*.cdn.prod.atlassian-dev.net/<app-id>/drawio/...`). Refs: `src/components/DrawIoExtension/ForgeGraphEditor.vue`, `src/forge-graph-viewer.ts`, `src/components/Viewer/ForgeGraphViewerEmbed.vue`. Don't reintroduce absolute `conf-full.zenuml.com/drawio/...` URLs — they will break in environments where that host isn't reachable.

**Only exception:** `manifest.yml` must keep the `app.connect` / Connect key / modules entries — Atlassian's Forge-from-Connect migration requires these to stay so that upgrade paths from legacy Connect installs still work. Don't remove those.

## Client privacy — no client names in public files

**Policy:** The names of specific Confluence client tenants (e.g. customer subdomain prefixes like `colesgroup`, full hostnames like `tenant.atlassian.net`, customer-named page titles, customer-specific `cloudId`s) **MUST NOT appear in any file checked into this public repo** — code, docs, comments, JSDoc, help text, fixtures, snapshots, ADRs, research specs, runbook examples. The public repo is intended to be open to anyone with the link; client identities are not.

**Where client-naming artifacts go:** The private companion repo `ZenUml/conf-app-private` is mounted as a git submodule at `private/`. Anything that names a real tenant lives there.

| Artifact | Public path | Private path |
|---|---|---|
| Per-customer paywall data, anomalies, interpretation, runbook examples | — | `private/paywall/*.md` |
| Research / design specs that reference real tenants | — | `private/research/<date>-<slug>.md` |
| Operations data (customer lists, migration trackers) | — | `private/operations/*` |
| Per-feature growth contracts (may reference tenants in baselines) | — | `private/growth/*.yml` |

**When writing new code or docs:**
- Use generic placeholders (`tenant-a`, `tenant-b`, `example-tenant`, `example.atlassian.net`, `example-one`, `example-two`) in any pedagogical example, JSDoc, or help text.
- For operational scripts that need to enumerate real domains, read them from the live KV/D1 source at runtime — never hardcode (see `.claude/skills/paywall/SKILL.md` for the `jq` pattern that pulls from `CUSTOMER_SUCCESS_SERVICE`).
- If a public-side doc legitimately needs to reference a worked example with a real tenant, put the example in a corresponding `private/<area>/<file>.md` and link to it from the public doc with a one-line summary that names no tenant.
- The `.gitignore` already excludes `/page-snapshot.yml`, `/paywall-snap-*.yml`, `/spotcheck-*.yml` at repo root — these often capture real page content and must stay local.

**Discovery:** Before committing, sanity-check with a grep:
```bash
grep -rE '[a-z0-9][a-z0-9-]+\.atlassian\.net' --exclude-dir=private --exclude-dir=node_modules --exclude-dir=.git \
  --include='*.md' --include='*.ts' --include='*.vue' --include='*.js' --include='*.py' --include='*.json' --include='*.yml' . \
  | grep -ivE '(zenuml|whimet|lite-stg|lite-dev|dia-stg|full-stg|peng-dev|example|tenant|foo|my-site|your-site|drawio|ecosystem|<)'
```
Expected output: empty. Any hits are likely real customer hostnames and should be moved to `private/` or replaced with a placeholder.

**Why this matters:** Historical violations of this policy (paywall references, customer lists in `operations/`, per-tenant research specs) were migrated to `private/` in #108. The cleanup found ~47 distinct customer names across 15+ files. Re-introducing client names into the public repo undoes that work and exposes customer relationships.

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

#### Forge CLI auth troubleshooting

Symptom: `forge whoami` (or any `forge` command) prints `Error: Not logged in. If a local keychain is available, run forge login...` even though you've already logged in elsewhere. Or `forge login` itself fails with `The CLI couldn't securely store your login credentials in a local keychain.`

Two root causes show up in this repo, often together:

1. **Native `keytar` binding not built.** The `keytar` npm package needs a postinstall step to compile `keytar.node`. If that step was skipped (cold pnpm install with prebuild-install offline, peer-dep warnings, etc.), keytar loads as a JS shell with no native ops, so reads return `null` and writes throw "couldn't securely store". Diagnose:
   ```bash
   ls node_modules/.pnpm/keytar@*/node_modules/keytar/build/Release/keytar.node
   # missing → not built
   ```
   Fix:
   ```bash
   pnpm rebuild keytar
   ```

2. **Login keychain is locked or auto-locks too aggressively.** `forge login` writes via `keytar.setPassword`, which fails immediately if the keychain is locked — and macOS would normally pop a password dialog to unlock, but the dialog can get suppressed in non-TTY contexts (Claude bash, IDE-spawned shells). Diagnose:
   ```bash
   security show-keychain-info ~/Library/Keychains/login.keychain-db
   # any non-zero "timeout=N" or "lock-on-sleep" means it auto-locks
   ```
   Fix — reset to never-auto-lock for the rest of the session:
   ```bash
   security set-keychain-settings ~/Library/Keychains/login.keychain-db
   ```
   Then re-run `forge login` from a real Terminal.app (not Claude bash — the email/token prompts need a TTY).

Order of operations when both are wrong: rebuild keytar first, *then* fix the keychain lock, *then* re-login. The rebuild is harmless to repeat.

If all else fails, use env vars (this is the documented non-interactive path, used by CI):
```bash
export FORGE_EMAIL=<your-email>
export FORGE_API_TOKEN=<token from id.atlassian.com/manage-profile/security/api-tokens>
forge whoami   # confirms
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

**Never commit directly to `main`** unless explicitly told to. Always create a feature branch for new work.

**Exception:** Changes to `.md` files only (docs, CLAUDE.md, README, etc.) may be committed directly to `main`.

### Starting work on an issue

When beginning a fix or feature, check the current branch state first:

**If on `main`:**
```bash
git checkout -b <feature-branch-name>
```

**If on a different feature branch:**
1. Check if the branch is clean: `git status`
2. **If clean** — switch back to main, pull, then create the new branch:
   ```bash
   git checkout main && git pull && git checkout -b <feature-branch-name>
   ```
3. **If dirty (uncommitted changes)** — stop and present these options:
   1. Commit the current changes first, then switch to the new branch
   2. Use a git worktree so both branches can coexist: `git worktree add ../conf-app-<feature> -b <feature-branch-name>`

Always use the `/superpowers:using-git-worktrees` skill when choosing option 2.

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

## Spot Checks

A **spot check** is an ad hoc, AI-driven, ephemeral verification of a specific behavior. It is not a pre-written test case and not meant for long-term use. Use it after developing a feature, fixing a bug, or reproducing an issue — to confirm the specific behavior works as expected.

**What it is NOT:** a pre-written `.spec.ts` file, a comprehensive regression test, or a repeatable automated test.

**Key principles:**
- **Lightweight**: reuse what already exists. If a page with the relevant macro is already available, use it — don't create a new one. If you know which macro has the issue, navigate to it directly.
- **AI-driven**: use Playwright MCP (`mcp__playwright__*`) to improvise the test steps — it is the only tool that can reach inside Forge iframes (see [Browser Automation and Forge Iframes](#browser-automation-and-forge-iframes)). Claude in Chrome can only be used for interactions outside the iframe (e.g., Confluence page navigation, checking page-level elements). No script is checked in.
- **Ephemeral**: the test steps are not saved for future use.
- **Targeted**: verify the specific behavior being checked, not a comprehensive regression.

**Choosing the environment:**

| Situation | Target environment |
|-----------|-------------------|
| New feature not yet deployed | Forge Tunnel → `lite-dev.atlassian.net` |
| Deployed to staging / failing pipeline | Staging site (e.g. `zenuml-lite@stg`) |
| Reproducing a production issue | Production site directly |
| Validating the test workflow itself | Any appropriate env |

**Verification methods — use whichever the behavior requires:**

| Signal | How |
|--------|-----|
| UI behavior | Playwright MCP (`mcp__playwright__*`) driving a real browser |
| Analytics events | Intercept requests to `api.mixpanel.com` via Playwright, or query via `mcp__mixpanel__Run-Query` with `project_id=3373228` |
| Forge logs | `forge logs --environment staging` / `forge logs --environment production` |
| Cloudflare Workers logs | `wrangler pages deployment tail --project-name <project>` |
| D1 database state | `wrangler d1 execute <db> --remote --command "SELECT ..."` |
| R2 object storage | `wrangler r2 object get <bucket>/<key>` |

Mix methods freely — a single spot check might drive the browser, then query D1 to confirm the record was written, then check Mixpanel to confirm the event fired.

**Workflow:**
1. Write a brief test plan first (before touching the browser or running any queries): the specific behavior being verified, the target page/macro or data path, and the expected observable signal for each assertion.
2. Navigate to the target Confluence site if UI interaction is needed (app profiles in `tests/e2e-tests/config/apps.ts`). Log in if needed (credentials from `.env.forge.local` or environment).
3. Reuse an existing page with the relevant macro — only create a new page if none exists.
4. Execute the plan using whichever verification methods apply. Assert the expected outcome at each step.

**Trigger phrases:** "run a spot check on X", "spot check zenuml-lite@stg", "spot check this fix", "spot check on staging", "verify on staging".

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
| `page_viewed`, `page_updated` | D1 `AnalyticsEventFact` (full hostname as `clientDomain`). Replaced `UserBehaviorEvent` on 2026-05-02; older rows still live in `UserBehaviorEvent` for May 1 and earlier. | Tenant activity signal — fires for any Confluence page with the macro installed, NOT specific to macro views |
| `macro_viewed` (renamed from `view_macro` on 2026-04-28) | Mixpanel only | Actual macro view counts; use for paywall/engagement analysis |
| Install/uninstall lifecycle | R2 `atlassian-events` bucket (`{domain}/lifecycle/{isoDate}.json`) | Forge install events |

> Mixpanel tracking for `page_viewed`/`page_updated` is intentionally commented out in `functions/forge-user-behavior.ts:62`.

### Interpreting `page_viewed` in D1

`page_viewed` fires whenever a user views any Confluence page on a site where our macro is installed. It does **not** mean the user viewed one of our macros. Use it to determine whether a **tenant is active on Confluence** (i.e., people are using the product at all). For macro-specific engagement, use Mixpanel `macro_viewed`.

The `AnalyticsEventFact` schema has richer columns than the legacy `UserBehaviorEvent` (key fields: `eventTime`, `eventDate`, `cloudId`, `macroUuid`, `diagramType`, `eventCategory`, `eventSource`, `appVersion`, `r2Key`). Aggregate views: `AnalyticsDailyEventSummary`, `AnalyticsWeeklyClientActivity`, `AnalyticsDailyCsat`.

### Key analytics sources

- **D1 `conf-zenuml-prod`** — tenant activity (`AnalyticsEventFact` since 2026-05-02; `UserBehaviorEvent` for ≤ 2026-05-01), install records (`ForgeInstallation`, `ClientInstallation`), content data
- **Mixpanel** — macro view counts (`macro_viewed`), filtered by `client_domain` property. **Project ID: `3373228`** (the `Diagramly.Ai` project; conf-app shares this single project — there is no separate one). Query via `mcp__mixpanel__Run-Query` with `project_id=3373228`, or via JQL using `API_Secret` from `.env.mixpanel`. Project display timezone is UTC+7, so hourly buckets need conversion when joining to D1 (which is UTC).
- **KV metrics-inspect** — macro counts per space: `https://conf-lite.zenuml.com/admin/metrics-inspect?domain=<subdomain>` (subdomain prefix only, e.g. `example-tenant` — not the full hostname)

### clientDomain format

Two stores, two conventions — always match the store's form:

| Store | Form | Example |
|---|---|---|
| KV flags | subdomain prefix | `example-tenant` |
| D1 (`AnalyticsEventFact`, `UserBehaviorEvent`) | full hostname | `example-tenant.atlassian.net` |
| Mixpanel — all events (frontend + backend) | **subdomain prefix** | `example-tenant` |

Frontend source: `getSubdomain()` in `src/utils/ContextParameters/ContextParameters.ts:42-45`.
Backend source: regex on hostname in `src/export.js:34` (fixed 2026-05-16 to match frontend format).

### Paywall / upgrade event mapping

The Lite paywall modal (`UpgradePrompt.vue`) is advocacy-only: there are no in-modal Marketplace or Enterprise Bundle CTAs. **Intent capture** is `advocacy_message_copied` when the user successfully copies the templated upgrade request.

| User action | Event fired | Key property |
|-------------|-------------|--------------|
| Clicks **"Upgrade" button in the viewer header** | `paywall_triggered` | `action_type: "header_badge"` (and `ui_component: "viewer_notice"`) |
| Hits a per-space limit while editing | `paywall_triggered` / `paywall_blocked_edit` | `action_type` set accordingly |
| Upgrade modal becomes visible (any path) | `upgrade_modal_shown` | `trigger_source` |
| Copies advocacy message inside the modal (clipboard succeeds) | `advocacy_message_copied` | `ui_component: "modal"` |
| Dismisses the modal | `upgrade_modal_dismissed` | `time_spent` |

Use `paywall_triggered` filtered by `action_type="header_badge"` for header Upgrade clicks — not modal copy events. Sources: `src/utils/upgradeTracking.ts`, `src/components/Viewer/GenericViewer.vue` (header → `paywall_triggered`), `src/components/UpgradePrompt/useUpgradeTracking.ts` (modal events).

## Agent skills

### Issue tracker

Issues live as GitHub issues on `ZenUml/conf-app` — use the `gh` CLI for all operations. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles, names verbatim: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context layout: `CONTEXT.md` + `docs/adr/` at the repo root (created lazily by `/grill-with-docs` as terms and decisions crystallise). See `docs/agents/domain.md`.

