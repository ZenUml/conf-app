# PR #1044: MCP sequence font CSP evidence

Candidate: `33c843ebdf6d1bdcd7f764459af291e7134c646e`.
Baseline: public production MCP resource, entry `view-Bup1lZxU.js`, core `zenuml-BbWv30VH.js`; deployment commit not independently identified.
Captured 2026-11-04 by the parent task in Chromium, viewport 1920×873. Fictional diagram: User → WebApp → Auth login flow.

The parent task ran the same host JSON-RPC handshake and sequence tool-result in local restrictive iframes using the actual production renderer and candidate build. The iframe CSP allows hosted fonts but excludes data: from font-src. Independent iframe listeners captured securitypolicyviolation and JavaScript errors. Both diagrams rendered. Production reported a font-src violation blocking data, candidate reported zero captured CSP or JavaScript violations. Screenshots alone do not prove the absence of CSP errors; see fixture-reports.json.

This is local restrictive iframe acceptance, not actual ChatGPT sandbox or CI-deployed staging acceptance. Reports and images were inspected and packaged by the implementing agent; capture was performed by the parent task.

Reproduction: check out the candidate, install locked dependencies, run `pnpm build:mcp-app`, copy `dist/mcp-app` to this directory as `candidate-app`, run `python3 strict-fixture.py`, then open `http://127.0.0.1:8771/?mode=current` and `?mode=candidate`. Reports are available at `/status` and written to fixture-reports.json. The baseline requires its historical public production assets to remain available.

Unit regression: onHostMessage → sequence tool-result → mocked core render asserts that both hosted font URLs have already been set. Before fix 30/31 passed (new test failed); after fix both MCP/font specs passed 32/32. Raw red/green logs are included.

Confluence Storybook and Forge Tunnel: N/A, because only the standalone MCP entry and its spec changed; shared font utility and Confluence UI did not change.
