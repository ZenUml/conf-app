# PR 988 browser E2E comparison — 2026-10-27

Before: `595c403c9cbd0f077f5c020fed390b23d7505ddd` (main at PR merge base).
After: `5a100e698ed521a7804870149cebcfe9af8da1d8` (tested PR head).

14/14 passed on each snapshot (7 flows × HTTP and HTTPS), 28/28 total. No skipped cases. Chromium via Playwright 1.59.1, Node 24.18.0, Vite 7.3.0. The exact same harness runs both snapshots. Normalized HTTP evidence matched for all 17 requests per protocol per snapshot. Cookie values are redacted; attributes, paths, TTLs, status and browser-sent cookie names remain.

This is local browser E2E with real unmodified authorize/callback/consent/register route modules loaded using Vite SSR, real HTTP(S), a real Chromium cookie jar, redirects and HTML form submission. The HTTP adapter dispatches the production route exports. It is NOT a complete deployed-system E2E: Node replaces the Cloudflare Pages runtime; KV is an in-memory Map; Atlassian authorization UI/token/me/sites responses are synthetic. Redirects to Atlassian are rewritten to 127.0.0.1 while our app runs on localhost, exercising cross-site top-level navigation. No production secrets or customer data are used. Real Atlassian login, deployed Cloudflare/KV, Confluence, MCP token exchange and diagram operations remain unverified by this run. Browser ignores the local self-signed certificate. HTTP localhost secure-context exemptions also apply; HTTPS explicitly checks the Secure flag.

Cases per protocol: first sign-in and three cookies; allow + code + cookie clearing + replay rejection; returning approved client across sites; returning user/new client + cancel; tampered returning cookie; upstream denial; mismatched callback state. Expected callback rejection warnings appear in run.log; they are assertions of negative cases, not harness errors.

## Reproduce

1. Set up `/private/tmp/pr988-cookie-e2e/{before,after}` using `git archive` at the SHAs above.
2. In `/private/tmp/pr988-cookie-e2e`, run `npm ci` using the provided package files and symlink each snapshot's node_modules to that installed directory.
3. Copy browser-e2e.mjs there and create `evidence/`.
4. Create a disposable certificate: `openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 2 -subj /CN=localhost`.
5. Ensure the Playwright Chromium browser is installed, then run `node browser-e2e.mjs > evidence/run.log 2>&1`.
6. Compare before/after `*-http-evidence.json` files (exact equality after the harness redaction).

The local key/certificate are intentionally excluded. This branch contains evidence only and does not modify the PR source branch.
