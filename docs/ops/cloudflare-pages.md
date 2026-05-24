# Cloudflare Pages projects

Each variant maps to a specific Cloudflare Pages project. Use these exact names with `wrangler pages secret put`, `wrangler pages deployment tail`, etc.

| Variant | Staging project | Production project | Public hostname (prod) |
|---------|-----------------|--------------------|------------------------|
| Lite | `conf-stg-lite` | `conf-lite` | `conf-lite.zenuml.com` |
| Full | `conf-stg-full` | `conf-full` | `conf-full.zenuml.com` |
| Diagramly | `conf-stg-lite` (shared) | `conf-lite` (shared) | (served from lite) |

Sources: `.github/workflows/build-test-deploy.yml` (staging), `.github/workflows/release.yml` (prod). The wrangler config (`wrangler.toml`) has a placeholder `name="confluence-plugin"` that CI replaces at deploy time via `sed` in `.github/actions/wrangler-publish/action.yml`.

## Setting a Pages secret

Example: `STRIPE_WEBHOOK_SECRET` (also used by [stripe-webhook.md](stripe-webhook.md)):

```bash
# Staging
wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=conf-stg-lite
# Production
wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=conf-lite
```

Pipe the secret so the value never appears in shell history or `ps`:

```bash
printf 'your-secret-value' | npx wrangler pages secret put STRIPE_WEBHOOK_SECRET --project-name=conf-stg-lite
```

## Route allowlist

New function paths must be added to `public/_routes.json` `include` array — otherwise Cloudflare Pages serves the path as static SPA HTML (200 `text/html`) instead of invoking the function.
