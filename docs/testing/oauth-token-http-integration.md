# OAuth token HTTP integration

Run `pnpm test:oauth-integration` from the repository root. The standalone Node test configuration builds the real Pages Functions router, starts a local workerd HTTP listener, and sends requests with Node fetch through the production middleware and handlers. It uses local Miniflare D1/KV and the exact production refresh-ledger migration (`0032`). No token handler, refresh ledger, or bearer-authentication function is mocked.

The two covered service-boundary scenarios are recorded in `tests/integration/oauth-token/scenarios.json`: `agent-authorization × oauth-protocol` and `agent-authorization × external-agent`. The targeted CI workflow runs this small API lane for relevant changes, including Draft PRs, independently of browser E2E authorization. It publishes JSON/JUnit results, the actual checked-out candidate commit/tree and scenario manifest. Existing browser selection and main Jev policy remain separate.

## What the tests prove

- An authorization-code fixture exchanges through the HTTP token endpoint; its returned access token succeeds at the real MCP `tools/list` HTTP endpoint.
- Wrong PKCE/client/redirect and consumed codes are rejected.
- Refresh rotates credentials; retry inside the five-minute window returns the same pair. Reuse beyond that window and cross-client refresh revoke both old and successor access tokens, observed through MCP HTTP responses.
- Live legacy KV refresh tokens migrate to the D1 ledger. Used/revoked legacy credentials do not revive.
- A missing D1 binding or failing actual D1 operation returns service-unavailable errors, without issuing a usable new token. Recovery is also checked through HTTP.

The production Pages route allowlist is checked for both endpoints. Miniflare executes the generated Pages router and production middleware; it does not emulate Cloudflare's edge application of `_routes.json`. The runtime's compatibility date and flags match `wrangler-stg.toml`. The fixture uses only temporary local storage, fake configuration and test identities. Worker outbound networking is denied and no Mixpanel token is supplied. Runtime and temporary build files are disposed after the suite.

## Scope limits

Authorization codes and client records are preconditions seeded through production fixture helpers; the tests do not cover the browser consent flow, third-party login, production deployments or a real Cloudflare edge. The local D1/KV emulation is not a remote storage test. Only migration 0032 is applied, not the application's full migration history. Full migration deployment is a separate check.

These are server HTTP integration tests, not browser E2E. Do not relabel existing mocked handler tests as equivalent evidence. Keep a missing-coverage label until the targeted lane has executed successfully for the candidate and the recorded coverage scope has been reviewed. A new protocol test channel does not by itself activate the pending trusted PR-selection controller.
