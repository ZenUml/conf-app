# Render MCP: attribute connections to the channel that published the URL

Status: plan, not started (2026-11-28).

## Problem

The public render MCP (`https://zenuml.com/mcp`) cannot tell where a user found
it. Render events have no user (`unknown_user_account_id`), and no referrer or
URL tag. The 2026-11-28 usage review could only match publish dates against the
handshake timeline. It also could not exclude our own traffic: only CI sends
`x-zenuml-internal-probe`, and a claude.ai connector cannot set a header.

## Approach

Publish a different URL in each channel, with a `via` query parameter, and record
it on every render event:

| Channel | Published URL |
|---|---|
| zenuml.com docs page (`ZenUml/docs` `docs/products/zenuml-render-mcp-server.md`) | `https://zenuml.com/mcp?via=docs` |
| `ZenUml/zenuml-plugin` `.mcp.json` (Claude Code / Cowork plugin) | `https://zenuml.com/mcp?via=plugin-claude` |
| `ZenUml/zenuml-plugin` `mcp.json` (Codex / ChatGPT plugin) | `https://zenuml.com/mcp?via=plugin-openai` |
| Claude directory connector listing | `https://zenuml.com/mcp?via=claude-dir` |
| ChatGPT app submission (when submitted) | `https://zenuml.com/mcp?via=chatgpt-dir` |
| `@zenuml/render-mcp` README, conf-app README pointers | `https://zenuml.com/mcp?via=readme` |
| Our own connectors (team claude.ai / Claude Code / Codex) | `https://zenuml.com/mcp?via=internal` |

Untagged requests (every existing install, and anyone typing the bare URL)
keep working unchanged and record `mcp_channel: 'none'`.

Why a query parameter rather than a path (`/mcp/c/docs`): the Worker route
`zenuml.com/mcp*` and `ENDPOINTS` both match on path, so a query string needs no
route or `_routes.json` change. Streamable HTTP clients POST every request to
the configured URL, so the tag should arrive on `tools/call` as well as
`initialize`. This is **unverified per client**: step 4 checks it.

## Analytics (first commit)

No new event. One new property on the existing render-mode events
(`agent_link_mcp_initialized`, `agent_link_mcp_tool_called`,
`agent_link_app_view_requested`, `agent_link_app_view_failed`):

- `mcp_channel`: closed enum
  `docs | plugin-claude | plugin-openai | claude-dir | chatgpt-dir | readme | internal | other | none`.
  `none` = no `via`; `other` = a `via` value outside the list (never record the
  raw value: it is client-controlled free text).
- `via=internal` also sets `internal_probe: true`, so the existing filter
  (`internal_probe is not set`) drops our own traffic with no query change.
  Spoofing it only hides the sender's own calls, the same trade as the header.

Add `mcp_channel` and its type to `src/utils/analytics/types.ts`.

**Volume and quota:** no new event, no sampling change, no session replay. The
events are already sent at full rate (`agent_link_mcp_initialized` in
`eventSampling.ts`), and render traffic is under 1,000 events a month (821
handshakes and 350 calls from 2026-10-31 to 2026-11-28). Change to the 1M event
cap: 0. Change to the 20k replay cap: 0.

The MCP Apps view events (`agent_link_app_view_rendered` and so on) come from the
browser via `/mcp/view-event` and do not see the MCP URL. They stay unattributed
in this change. Tying them needs the channel passed in the UI resource or tool
result `_meta`, which is a follow-up.

## Steps

1. **conf-app (one PR).**
   - `workers/render-mcp/index.ts`: the Worker replaces the request with
     `new Request(`${origin}/mcp`, request)`, which drops the query string. Read
     `via` from the original `url` first and pass it to `handleRenderRequest`
     (a new `deps.channel`, or a header set on the canonical request).
   - `functions/mcp/render.ts` (Pages alias on `conf-lite`, `/mcp/render`): read
     the same parameter, so the alias behaves the same.
   - `functions/agent-link/renderMcp.ts`: map `via` to the enum, add
     `mcp_channel` in `trackEvent`, and set `internal_probe` for `internal`.
   - Unit tests in `functions/agent-link/renderMcp.spec.ts` and
     `workers/render-mcp/index.spec.ts`: known value, unknown → `other`,
     absent → `none`, `internal` sets `internal_probe`, the query string
     survives canonicalisation, `?via=` does not change the response.
   - Not applicable: Storybook → tunnel → staging UI validation (no Confluence UI
     change). Persisted data changes: none (Mixpanel only; D1 `McpRenderRate`
     untouched).
2. **Deploy.** Merge; the preview Worker deploys from the PR. Production is a
   manual `render-mcp-deploy.yml` dispatch with the main SHA (the workflow
   never deploys production by itself), so the owner triggers it. Preview has no
   `MIXPANEL_TOKEN`, so tagging can only be confirmed in Mixpanel after
   production.
3. **Tag our own connectors first.** Change the team's claude.ai, Claude Code and
   Codex render connectors to `?via=internal`. Then a day of data shows how much
   of the `claude-code` growth was ours.
4. **Check each host keeps the query string.** On production, connect claude.ai,
   Claude Code, Codex and opencode with `?via=internal`, run one `render_diagram`,
   and confirm in Mixpanel that both `_initialized` and `_tool_called` carry
   `mcp_channel: internal`. A host that drops it means a path-based tag for that
   channel instead.
5. **Republish the channels** (outside this repo):
   - `ZenUml/docs`: the URL on the render MCP page. Also check whether
     `functions/mcp.js` there still receives traffic. It proxies to
     `conf-lite.zenuml.com/mcp/render` without the query string, and the Worker
     route on `zenuml.com/mcp*` probably shadows it. If it is live, it needs the
     query string forwarded.
   - `ZenUml/zenuml-plugin`: both `mcp.json` files, and bump `version` in both
     `plugin.json` files.
   - Claude directory listing: edit the connector URL at
     claude.ai/directory/manage. Owner action. It is unknown whether a URL edit
     triggers re-review. Ask or check before changing it.
6. **Read the result** after 2–4 weeks: handshakes and calls by `mcp_channel`,
   internal excluded, beside the 2026-11-28 baseline.

## Open questions

- Is the 2026-10-31 Claude directory submission approved and publicly listed?
  If not, `claude-dir` will stay empty and claude.ai users came from elsewhere.
- Does changing the listing URL reset review? (Decide before step 5.)
- Do existing users ever re-add the server? Old installs stay `none` for good,
  so attribution covers only new installs.
