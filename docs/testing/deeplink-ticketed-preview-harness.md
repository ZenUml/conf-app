# Deeplink ticketed-preview — AI harness test plan

AI-driven, ephemeral verification of the parts no checked-in automation can reach: real
Forge-authed minting, Slack's actual crawler behavior, wall-clock KV expiry, and the
receiver's cross-auth experience. Run with the **spot-check** skill's rules: every
assertion pass/fail before starting; a missing signal is NOT a failed assertion; every
negative probe needs a positive control.

**Layers below this one** (run them first — they're cheap and gate this plan):

| Layer | Command | Covers |
|---|---|---|
| Unit (31 tests) | `npx vitest run functions/deeplink-ticket.spec.ts workers/confluence-deeplink/src/index.spec.ts` | mint validation, 3 page states, XSS/open-redirect/token-binding gates, expiry boundary |
| Contract | `npx vitest run functions/deeplink-ticket.contract.spec.ts` | mint→worker KV key/value format, TTL placement, #360-compatible URL shape |
| Worker E2E (workerd) | `pnpm --filter confluence-deeplink test:e2e` | real runtime + binding wiring, headers |
| Confluence paste E2E | `cd tests/e2e-tests && EMBED_AUTOCONVERT_LIVE=1 npx playwright test embed-deeplink-paste` | autoConvert on bare AND ticketed links, negative control |

## Ground rules (paid-for gotchas)

- **KV CLI needs `--remote`** — without it every put/get/list hits local miniflare and
  self-consistently lies (see `workers/confluence-deeplink/README.md`).
- Fixtures use the **internal tenant only** (`zenuml.atlassian.net` or lite-dev) — never a
  customer cloudId/domain. Delete every seeded key afterwards (`wrangler kv key delete … --remote`).
- Slack unfurl caching is per-URL and sticky: use a **fresh token per probe**, or Slack
  serves you yesterday's cached card and the assertion means nothing.
- The Slack web client has **no Forge iframes** — claude-in-chrome / Playwright MCP both
  work there; Playwright is only mandatory inside Confluence.

## Phase 1 — real mint (until the completion-screen UI exists)

Mint by hand-driving the real backend, which exercises auth + D1 domain resolution + KV:

1. In a logged-in Confluence page with a rendered macro (lite-dev), capture a live FIT
   token: DevTools → any `invokeRemote` request → `Authorization` header (they expire in
   minutes — mint immediately).
2. `curl -X POST https://<lite backend>/deeplink-ticket -H "Authorization: Bearer <FIT>" -d '{"contentId":"<real id>","pageId":"<its page>","title":"Harness probe","pngBase64":"<capturePng of that diagram, or any small PNG>"}'`

- [ ] 200 with `{token, url, imageTtlSeconds:600}`; url matches `/d/<cloudId>/<contentId>?t=<token>` [curl]
- [ ] `wrangler kv key list --namespace-id <prod> --remote` shows `img:` **and** `ticket:` for the token [CLI]
- [ ] Replay with a garbage Authorization header → 401 from middleware, **nothing written to KV** (positive control: the good token minted) [curl + CLI]

Once the activation completion screen ships, replace steps 1–2 with clicking **Copy for
Confluence** and intercepting the network call (Playwright, inside the Forge iframe).

## Phase 2 — Slack crawler simulation (deterministic, before real Slack)

- [ ] `curl -A "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)" <minted url>` → 200, `og:image` present, **no `<meta http-equiv="refresh">` dependency for the card** [curl]
- [ ] Fetch the `og:image` URL with the same UA → 200 `image/png`; **SHA-256 equals the minted PNG's** — the crawler gets the true bytes, not a placeholder [curl + shasum]
- [ ] The preview page contains no cloudId/contentId echo beyond the URL itself, and `x-robots-tag: noindex` on both responses [curl -sI]

## Phase 3 — real Slack unfurl (AI-driven browser)

Drive the user's Slack workspace (a private test channel), claude-in-chrome or Playwright:

- [ ] Paste the minted URL → within ~10 s the card renders **the diagram image** with title [screenshot]
- [ ] The card's image element src is a `slack-imgs.com`/Slack-proxied URL, NOT confluence.zenuml.com — Slack re-hosted it, which is what makes expiry invisible to old messages [DOM inspect]
- [ ] After Phase 5 expiry: the SAME message still shows the image (Slack cache) [screenshot]
- [ ] Paste the SAME url in a **different** channel after expiry → card degrades to the generic (no-image) form [screenshot; needs the fresh-token discipline — this is why]

## Phase 4 — receiver click-through

- [ ] Insider: browser with lite-dev session opens the minted url → preview page → "Open in Confluence" lands on the source page, diagram visible [Playwright]
- [ ] Outsider: fresh incognito context opens the Confluence button target → Atlassian login wall, no content leak [Playwright, no storageState]
- [ ] Paste the TICKETED url into a Confluence page (insider) → autoConverts to the embed macro and renders the diagram (the flywheel's return path; automated twin exists in `embed-deeplink-paste.spec.ts`) [Playwright]

## Phase 5 — wall-clock expiry (the one nothing else tests)

Unit tests fake the clock; contract tests fake KV. Only this proves Cloudflare's actual
`expirationTtl` behavior end to end:

- [ ] Note mint time. Wait ≥11 min (Monitor until-loop on `curl -s -o /dev/null -w "%{http_code}" <og:image url>` ≠ 200; KV expiry has up-to-60s granularity — assert at 11 min, not 10:01) [Monitor]
- [ ] `/i/<token>` → 404; landing page → "This preview has expired" + working Open-in-Confluence button [curl]
- [ ] `ticket:` key still exists in KV; `img:` key gone — permanence split held physically [CLI --remote]

## Phase 6 — privacy & hygiene sweep

- [ ] `wrangler deployments status` worker version has `observability enabled = false`; no Logpush configured on the worker [CLI/dashboard read]
- [ ] Search this plan's artifacts for customer identifiers before filing anything public (client-privacy policy) [grep]
- [ ] Delete all seeded/minted test keys (`ticket:` + `img:`) with `--remote`; verify both namespaces contain no `Harness probe` leftovers [CLI]

## Known-unresolved (do not silently re-open)

- lite+full co-installed matcher conflict: accepted known issue (dossier §6) — needs a
  dedicated experiment with full@dev installed alongside lite on one dev site, not this plan.
- Slack image-proxy cache eviction: observed behavior, not contract; a broken image in an
  old message after months is within accepted risk, not a regression.
