# confluence-deeplink — instruction page for embed deeplinks

Serves `https://confluence.zenuml.com`, the host used by the embed autoConvert
deeplink (`/d/<cloudId>/<contentId>`, PR #360).

## Why it exists

Inside Confluence the deeplink never resolves over the network: the editor's
server-side **autoConvert matcher** (registered in `manifest.yml` at app install)
intercepts the paste and converts it into an Embed macro. This Worker exists for
every other place the link lands — Slack, email, a browser address bar. Without
it the domain has no DNS record and those links dead-end at a resolver error.

- `/d/*` → static instruction page (200). Loose match on purpose; the strict
  shape is enforced by the manifest matcher and `src/utils/embedDeeplink.ts`.
- `/` → 302 to zenuml.com.
- anything else → 404.
- Slack/link unfurls are controlled by the page's OG meta tags. The crawler is
  unauthenticated, so an unfurl can never reveal diagram content.

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
