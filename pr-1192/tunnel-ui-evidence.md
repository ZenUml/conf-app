# Forge Tunnel UI observation

Candidate a87551e9; Lite; development environment; 16 Nov 2026 client date.
Site: lite-dev.atlassian.net. Browser: live daily Chrome Conf App (Profile8), account matched Forge CLI's owner. agent-browser's copied profile reached login, so live Chrome through CUA was used instead; no credentials were entered.

Frontend source: isolated candidate worktree. Port8080 belonged to another worktree, left untouched. Only the resource tunnel port was temporarily changed8080→8088 in the isolated worktree, then restored byte-for-byte. Vite started FORGE_TUNNEL=1 PORT=8088; Forge tunnel became Listening for requests. No development or staging deployment was performed.

## Observed iframe DOM

host: localhost:8000
scripts:
- https://forge.cdn.prod.atlassian-dev.net/global-bridge.js
- https://forge.cdn.prod.atlassian-dev.net/iframeResizer.contentWindow.min.js
- /@vite/client
- /src/forgeIndex.ts

Rendered UI excerpt:

```text
Plan and usage
lite-dev
127 Diagrams on this site
1 Spaces over the Lite limit of100
Spaces over the limit
Unlock one space by card. This purchase applies only to the selected space.
Space | Diagrams / limit | Unlock one space
SD |127 /100 |$299/yr/space |Unlock this space
Upgrade to Full
Full removes the per-space limit on every space on this site.
Atlassian Marketplace handles pricing and purchase.
Request Full |View on Marketplace
```

Clicking the SD row's actual button displayed Confluence's external-link confirmation:

```text
Opening external page on buy.stripe.com
Plan and usage is sending you to an external page. Ensure you trust that page before you continue.
https://buy.stripe.com/cNifZifkN7hzavK12H7IY05?client_reference_id=lite-dev__SD
Cancel |Continue
```

Clicked Cancel. No checkout confirmation or payment was performed.

Screenshots of both observed states were emitted in the Codex chat. This durable text excerpt records the CUA accessibility snapshot and read-only iframe DOM inspection; the published before/after image comparison uses Storybook fixtures.

## Limits
Live usage had one over-limit space, so this verified the single-key compatibility path against the existing staging backend. The candidate's new multi-row backend branch is covered by local authenticated HTTP handler tests; its deployed integration remains for CI staging. Mixed paid/user/unknown/personal/exact-limit states were observed in Storybook fixtures, not fabricated on this live tenant.
