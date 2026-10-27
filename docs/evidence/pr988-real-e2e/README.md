# PR #988 — real-service Before / After acceptance

Run on 2026-10-27 against `https://conf-stg-lite.zenuml.com` and the team's `lite-stg` Confluence test site. CI owner: [40500550575](https://github.com/ZenUml/conf-app/actions/runs/40500550575), using the shared `conf-app-staging` lock throughout deployment, browser acceptance and restoration.

| | Before | After |
|---|---|---|
| Exact application source | `595c403c9cbd0f077f5c020fed390b23d7505ddd` | `5a100e698ed521a7804870149cebcfe9af8da1d8` |
| Selected real scenarios | 8/8 PASS | 8/8 PASS |
| Confluence diagram versions: original → edit → restore | 1 → 2 → 3 | 3 → 4 → 5 |

## What actually ran

1. A real public OAuth client registered with deployed DCR (HTTP 201), generated PKCE, and opened the deployed authorize endpoint in Chrome. Atlassian's actual consent page was used to select `lite-stg` and Accept. The deployed callback led to our consent page; Allow delivered a code to the client's loopback callback and the actual token endpoint returned HTTP 200.
2. The approved returning client received another code and token without another consent screen.
3. A new client for the returning user displayed our consent page; Allow completed a real token exchange.
4. Another new client displayed consent; Cancel returned `access_denied`. The client made no token request for that denial.
5. The issued MCP token completed initialize, list_sites, list_diagrams and read_diagram against real services.
6. update_diagram changed only the DSL title to `PR988 REAL BEFORE` / `PR988 REAL AFTER`. A separate read confirmed persistence, and the actual Confluence Forge macro displayed that title.
7. update_diagram restored the complete original DSL. Another read confirmed byte-for-byte equality, and the Confluence UI displayed `Order Service` again.
8. A real refresh_token exchange returned HTTP 200 and a different refresh token on each deployment.

The original/restored DSL SHA-256 is `bf3c8cdb4f885affdb8add427a1e1f2d908c78f97bc5b615286ab8ae5ba7196f` on both sides. The test diagram was existing CI smoke data, not customer content. Restoration creates new Confluence versions; it does not remove version history.

## Evidence and boundaries

- `results.json`: checks against captured real responses plus screenshots; browser actions and UI observations were performed by the agent.
- `events.jsonl`: actual client request outcomes and timestamps, with codes/tokens omitted.
- `*-deployment.json`: CI provenance, exact source/tooling SHAs, hashes, successful Forge deployment and verified backend marker.
- `*-cookies.json`: consent and returning-user cookie metadata observed in Chrome, with values removed. Both sides show HttpOnly, Secure and SameSite=Lax; only the returning-user cookie remains after Allow. Callback success exercised the real state-cookie round trip; detailed state-cookie metadata was additionally captured privately on After.
- `*.png`: actual consent, denial, returning-client, edited-diagram and restored-diagram screenshots. Diagram captures isolate the macro iframe. Its visible UI was served from Atlassian's Forge CDN; OAuth/MCP requests went to the verified staging Pages deployment.
- `oauth-client.mjs` / `mcp-client.mjs`: the actual loopback OAuth/MCP client used. These call deployed services directly. Run paths are deliberately local; credentials and raw service bodies remain in the private local directory, not this branch.
- `orchestration.yml`: the executed temporary CI orchestration, pinned to commit `2d52fa27c57c464d994ff88ff70f4ccf2d0ba3a1`. No staging deployment was performed from a local shell. No migrations were applied by this verification run.

DCR, pending authorizations, consents and token handles were written and reloaded through the deployed KV implementation. Successful refreshes exercised the deployed mandatory D1 refresh ledger. Staging KV and D1 bindings were verified to be separate from production in the deployment configuration. Database rows were not independently dumped. No Atlassian, Confluence, KV or D1 service was substituted. Loopback is the real OAuth **client redirect**, not an upstream substitute.

Browser control started with agent-browser. HAR recording timed out before OAuth; the owned browser was recovered. A later agent-browser accessibility read also timed out. Direct Playwright/CDP control of that same owned Chrome completed After. No acceptance assertion was credited from a timeout. The owned browser and loopback client were closed after testing.

This is HTTPS staging acceptance, not production validation. Upstream Atlassian Cancel, tampered cookies and malformed callback state were not rerun live; older synthetic coverage remains supplementary. The PR changes backend cookie code only, so Storybook/Forge Tunnel UI-change validation is not applicable. Actual deployed Confluence UI evidence is included for the requested E2E flow.

Staging restoration is tracked separately in `restore-deployment.json` once complete. Original PR description and supplementary synthetic evidence are preserved below the real evidence in the PR body. Real OAuth client registrations/approvals remain as staging test data under their normal retention; existing account grants were not revoked as cleanup. PR #988 was not merged or rebased.
