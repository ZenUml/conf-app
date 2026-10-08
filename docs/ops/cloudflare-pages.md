# Cloudflare Pages projects

Each variant maps to a specific Cloudflare Pages project. Use these exact names with `wrangler pages secret put`, `wrangler pages deployment tail`, etc.

| Variant | Staging project | Production project | Public hostname (prod) |
|---------|-----------------|--------------------|------------------------|
| Lite | `conf-stg-lite` | `conf-lite` | `conf-lite.zenuml.com` |
| Full | `conf-stg-full` | `conf-full` | `conf-full.zenuml.com` |
| Diagramly | `conf-stg-lite` (shared) | `conf-lite` (shared) | (served from lite) |
| AsyncAPI | `conf-stg-lite` (shared) | `conf-lite` (shared) | `zenapi.zenuml.com` — the live AsyncAPI backend, which proxies the Forge backend paths (`/forge-*`, `/api/*`, …) to `conf-lite` |

A Pages project is a hostname plus a copy of `functions/`, not a data boundary. Both staging projects bind the same D1 (`conf-zenuml-stg`), KV and R2 (`wrangler-stg.toml`; the publish action only `sed`s the project name), and `functions/` has no `PRODUCT_TYPE` switch, so one commit gives identical backend bytes whichever variant builds it. The variant changes `dist/`, which Forge serves from its own CDN. Main staging applies shared D1 migrations once, then each product uses the regular combined Pages and Forge deployment with `skip-migrations: true`. Lite, Diagramly and AsyncAPI can republish `conf-stg-lite` at the same pinned SHA while their E2E checks run independently. The staging `dist/__ci-version.json` retains `{sha, variant}`; these parallel staging checks explicitly use SHA-only backend verification with a valid variant marker. Other callers keep strict SHA and variant verification by default.

Sources: `.github/workflows/main-staging-validation.yml` + `.github/workflows/staging-deploy.yml` (staging), `.github/workflows/release.yml` (prod). CI builds `wrangler.toml` at deploy time from `wrangler-stg.toml` / `wrangler-prod.toml`, replacing the placeholder `name="conf-<environment>"` with the project name via `sed` in `.github/actions/wrangler-publish/action.yml`.

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

## `wrangler pages publish` vs `wrangler pages deploy` (bindings)

The npm scripts `wrangler:publish:stg` / `wrangler:publish:stg:lite` use the **deprecated** `wrangler pages publish dist --project-name X` form, which **ignores `wrangler.toml`** for KV/D1/R2 binding configuration — bindings come from the Cloudflare Pages project dashboard. The newer `wrangler pages deploy dist --project-name X` form **does** read bindings from `wrangler.toml`. When adding a new KV/D1/R2 binding, either add it in the Pages dashboard or deploy with `wrangler pages deploy` and a generated `wrangler.toml` — `pnpm wrangler:publish:stg:lite` alone will not pick it up.

## Route allowlist

New function paths must be added to `public/_routes.json` `include` array — otherwise Cloudflare Pages serves the path as static SPA HTML (200 `text/html`) instead of invoking the function.
