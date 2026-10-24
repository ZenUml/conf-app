# Stripe webhook (`/api/stripe-webhook`)

Auto-activates a space license in `SPACE_LICENSE_KV` when Stripe fires `checkout.session.completed`. Handler: `functions/api/stripe-webhook.ts`.

**Mandatory bindings:** `STRIPE_WEBHOOK_SECRET` and `SPACE_LICENSE_KV`. Without either, the function returns `500 server_configuration`.

Cloudflare project names: [cloudflare-pages.md](cloudflare-pages.md).

## Stripe-side configuration

Test and Live webhooks are separate:

| Stripe mode | Endpoint URL | Cloudflare project for the secret |
|-------------|--------------|-----------------------------------|
| Test | `https://conf-stg-lite.pages.dev/api/stripe-webhook` | `conf-stg-lite` |
| Live | `https://conf-lite.zenuml.com/api/stripe-webhook` | `conf-lite` |

**Required event:** `checkout.session.completed`.

The Stripe Checkout session must include `cloudId` and `spaceKey` in `session.metadata` — without them the webhook returns `400 missing_metadata` and no license is activated.

## Smoke test (no Stripe needed)

Confirms the function is deployed, `public/_routes.json` routes it through Pages Functions, and secret + KV bindings are set:

```bash
curl -i -X POST "https://conf-stg-lite.pages.dev/api/stripe-webhook" \
  -H "Content-Type: application/json" -d '{}'
```

| Response | Meaning |
|----------|---------|
| HTTP 400 `{"error":"missing_signature"}` | Expected — function live, secret bound |
| HTTP 500 `server_configuration` | Secret or KV binding missing |
| HTTP 405 empty body | Route not in `_routes.json` |
| HTTP 200 `text/html` | SPA fallback — function not deployed |

## Verify license after a real event

```bash
# Find the SPACE_LICENSE_KV namespace ID in wrangler.toml
npx wrangler kv key get --namespace-id <SPACE_LICENSE_KV_ID> --remote \
  "license:<cloudId>:<spaceKey>"
```
