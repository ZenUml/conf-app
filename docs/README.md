# docs/

Developer documentation for the ZenUML Confluence Cloud Add-on. See `CLAUDE.md` in the repo root for the AI assistant guide (architecture overview, hard rules, local dev setup).

## Directory Index

| Directory | Contents |
|-----------|----------|
| `adr/` | Architecture Decision Records — timestamped, immutable design decisions |
| `analysis/` | Technical analyses and implementation notes for specific subsystems |
| `analytics/` | Analytics event catalog, data flow, and upgrade tracking reference |
| `debugging/` | Troubleshooting guides for recurring operational issues |
| `features/` | Feature-level documentation (paywall, export, fullscreen, banners) |
| `ops/` | Operations runbooks (Cloudflare Pages, Stripe webhooks) |
| `policies/` | Team policies: client privacy, Forge-only rule, git workflow |
| `reference/` | Developer reference: data models, errors, monitoring, test fixtures |
| `superpowers/` | Historical AI-generated design specs and planning artifacts |
| `adoc/` | AsciiDoc contributor guide |
| `pricing-model.yml` | Product pricing and licensing reference (Marketplace tiers, Lite limits, Enterprise Bundle) |

## Quick Links

**Before writing any code:**
- [Policies: Git workflow](policies/git-workflow.md) — branching, worktree rules, commit policy
- [Policies: Forge-only](policies/forge-only.md) — banned APIs, `@forge/bridge` replacements
- [Policies: Client privacy](policies/client-privacy.md) — no tenant names in public files

**Analytics:**
- [Analytics reference](analytics/reference.md) — canonical event names, properties, Mixpanel project ID
- [Events flow](analytics/events-flow.md) — how events flow through the macro lifecycle
- [Upgrade tracking events](analytics/upgrade-tracking-events.md) — upgrade funnel event reference

**Features:**
- [Paywall](features/paywall.md) — strategy, implementation, bypass notes, metered soft-paywall mechanics
- [Export pipeline](features/export-pipeline.md) — attachment export pipeline
- [Fullscreen modal](features/fullscreen-modal.md) — fullscreen bridge modal lessons

**Operations:**
- [Cloudflare Pages](ops/cloudflare-pages.md) — project table (lite/full/diagramly), CI sources, secrets
- [Pricing model](pricing-model.yml) — Marketplace tiers, Enterprise Bundle, space-license KV check

**Reference:**
- [Data models](reference/data-models.md) — core domain models
- [Paid space detection](reference/paid-space-detection.md) — how the space license check works
- [Monitoring](reference/monitoring.md) — observability setup

**Debugging:**
- [Forge CLI auth](debugging/forge-cli-auth.md) — keychain / non-TTY login issues
- [Orphaned custom content](debugging/forge-save-creates-orphaned-content.md) — orphaned content debugging

**Architecture decisions:** browse `adr/` — files are prefixed with date `YYYY-MM-DD-`.
