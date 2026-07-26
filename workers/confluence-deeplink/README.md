# confluence-deeplink — instruction page for embed deeplinks

Serves `https://confluence.zenuml.com`, the host used by the embed autoConvert
deeplink (`/d/<cloudId>/<contentId>`, PR #360).

## Why it exists

Inside Confluence the deeplink never resolves over the network: the editor's
server-side **autoConvert matcher** (registered in `manifest.yml` at app install)
intercepts the paste and converts it into an Embed macro. This Worker exists for
every other place the link lands — Slack, email, a browser address bar. Without
it the domain has no DNS record and those links dead-end at a resolver error.

- `/d/<cloudId>/<contentId>?t=<token>` with a **fresh ticket** (<10 min) →
  preview page: the diagram PNG + "Open in Confluence". `og:image` serves the
  PNG, so the Slack unfurl card IS the diagram; Slack's image proxy caches it,
  carrying the display after our source expires.
- same with a **live ticket but expired image** → "preview expired" page + the
  permanent Open-in-Confluence button (target from the ticket — never resolved
  from a bare cloudId, which would create a public cloudId→hostname resolver).
- `/d/*` without a usable ticket → static instruction page (200). Loose match
  on purpose; the strict shape is enforced by the manifest matcher and
  `src/utils/embedDeeplink.ts`.
- `/i/<token>` → preview PNG bytes; 404 after KV physically expires the object.
- `/` → 302 to zenuml.com; anything else → 404.
- Tickets are minted by `functions/deeplink-ticket.ts` (Forge-authed, the
  minter is viewing the diagram with read permission). KV keys: `img:<token>`
  (PNG, `expirationTtl=600` — physical deletion IS the capability expiry) and
  `ticket:<token>` ({d,p,c,t,m}, no TTL). Without the `DEEPLINK_KV` binding the
  Worker behaves exactly like v1 (instruction page only).

## Contract — keep these three in sync

| Place | Shape |
|---|---|
| `manifest.yml` embed macro `autoConvert.matchers` | `https://confluence.zenuml.com/d/*/*` |
| `src/utils/embedDeeplink.ts` `DEEPLINK_RE` | `/d/<uuid>/<digits>` |
| this Worker | any `/d/*` |

## Privacy (do not regress)

`/d/*` paths identify customer sites (cloudId + contentId). Per
`docs/policies/client-privacy.md`:

- **No logging of request URLs** — no `console.log`, `[observability]` stays
  `enabled = false`, no Logpush. Volume comes from the dashboard's built-in
  Worker metrics (counts only, no URLs).
- The response never reflects path segments (`default-src 'none'` CSP, static
  HTML only).
- `noindex` meta + `X-Robots-Tag` keep customer link paths out of search indexes.

## Operating gotchas (paid for on 2026-07-26)

- **wrangler v4 `kv key put/get/list` default to LOCAL miniflare storage**
  (`.wrangler/state`), silently. Without `--remote` your writes AND readbacks
  hit a local store that agrees with itself — while the real namespace stays
  empty. Symptom: CLI sees keys the deployed Worker can't, and vice versa.
  Always pass `--remote` when seeding/inspecting real namespaces.
- The Workers runtime refuses to start a module Worker with a non-handler
  named export (`export const X` → "Incorrect type for map entry").
- Top-level `name` and `[env.production] name` must differ, or
  `deploy:preview` silently overwrites the production service.

## Deploy

```bash
pnpm --filter confluence-deeplink typecheck
pnpm --filter confluence-deeplink deploy:preview   # *.workers.dev smoke test, no DNS change
pnpm --filter confluence-deeplink deploy:prod      # binds confluence.zenuml.com (creates DNS record)
```

The prod deploy is a cloud change (creates/owns the `confluence` DNS record on
the zenuml.com zone) — needs explicit approval per workspace safety rules.

## Verify after deploy

```bash
dig +short confluence.zenuml.com                       # resolves
curl -sI https://confluence.zenuml.com/d/x/1 | head -5  # 200, text/html, x-robots-tag
curl -s  https://confluence.zenuml.com/d/x/1 | grep og:  # unfurl tags present
curl -sI https://confluence.zenuml.com/          # 302 → zenuml.com
```

## Release gate

PR #360 stays **draft** until this page is live and verified — merged manifest
changes ride the next release train unconditionally, so the gate is the merge.
