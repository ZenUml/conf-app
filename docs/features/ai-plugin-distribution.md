# Distributing the MCP server as a Claude plugin and a ChatGPT plugin

The headless MCP endpoint (`https://conf-lite.zenuml.com/agent-link/mcp`, see
[MCP Apps diagram view](mcp-app-view.md) and
`docs/superpowers/specs/2026-09-19-headless-diagram-mcp-design.md`) is what both
directories list. The package that wraps it lives in its own repository,
[ZenUml/zenuml-plugin](https://github.com/ZenUml/zenuml-plugin); edit it there.
One package serves both:

| File | Read by |
|---|---|
| `.claude-plugin/plugin.json`, `.mcp.json` | Claude (plugin directory, Claude Code, Cowork) |
| `plugin.json` (Agent Plugins 1.0.0, `extensions.com.openai`), `mcp.json` | ChatGPT / Codex plugin directory |
| `skills/confluence-diagrams/SKILL.md`, `README.md`, `LICENSE`, `assets/logo.png` | both |

Checked 2026-10-23: `claude plugin validate .` in that repository passes, and both
`plugin.json` and `mcp.json` validate against the
`https://agent-plugins.org/schemas/1.0.0/` schemas.

## Server requirements, and where each is met

| Requirement | Source | Where |
|---|---|---|
| Every tool has a `title` and `readOnlyHint` / `destructiveHint` | [Claude connector submission](https://claude.com/docs/connectors/building/submission), [review criteria](https://claude.com/docs/connectors/building/review-criteria) | `HEADLESS_TOOLS` in `functions/agent-link/oauth/headlessTools.ts`. All four write tools are `destructiveHint: true`, so Claude always asks before a write. The diagram.write scope set in `headlessMcp.ts` is derived from the same annotations. |
| OAuth 2.0 with DCR | both | Already served: `functions/agent-link/oauth/`. DCR accepts any `https` redirect URI, so `claude.ai` and `chatgpt.com` callbacks register without config. |
| MCP Apps UI (`ui://`, `text/html;profile=mcp-app`, `_meta.ui.resourceUri`, csp on the resource) | [ChatGPT MCP Apps compatibility](https://developers.openai.com/apps-sdk/mcp-apps-in-chatgpt) | Already served: `functions/agent-link/oauth/mcpApps.ts`. Not yet exercised in ChatGPT. |
| Domain verification: the token as plain text at `/.well-known/openai-apps-challenge` | [ChatGPT submission](https://developers.openai.com/apps-sdk/deploy/submission) | `functions/agent-link/openaiAppsChallenge.ts`, served from `_middleware.ts` and listed in `public/_routes.json`. Set the token with `wrangler pages secret put OPENAI_APPS_CHALLENGE --project-name conf-lite`. Unset answers 404. |

## Why the plugin needs its own repository

The Claude directory reads plugins from a public GitHub repository and stops
validation for a repository over 50 MiB as GitHub archives it. conf-app's
`git archive --format=tar.gz HEAD` is 50.4 MiB (measured 2026-10-17), so the
plugin cannot be submitted from here. It lives at the root of
`ZenUml/zenuml-plugin` instead, which must be public before the listing goes
live. Placing the plugin at the repository root also avoids
the subfolder-only reviewer holds in the
[pre-submission checklist](https://claude.com/docs/plugins/pre-submission-checklist).

## Submission steps

### Claude

1. Submit the **connector** first, at <https://claude.ai/directory/manage> →
   Submit new → MCP connector, with the endpoint URL above. It needs the
   listing details, an icon, 3–5 PNG carousel screenshots of the rendered
   diagram view (at least 1000 px wide, cropped to the app response), and
   test-account credentials for a fully populated Confluence site.
2. Submit the **plugin**: Submit new → Plugin bundle, repository
   `ZenUml/zenuml-plugin`, then Validate and fix any blocking finding.
3. Raise `version` in both `plugin.json` files with every release.

### ChatGPT

1. Set `OPENAI_APPS_CHALLENGE` on `conf-lite` to the token the dashboard issues,
   and confirm `curl https://conf-lite.zenuml.com/.well-known/openai-apps-challenge`
   returns it alone.
2. Submit with MCP. Enter the reviewer credentials in **Review details**, never
   in the package: an account that signs in without MFA, email codes or magic
   links.
3. Replace `review.demo_recording_url` in `plugin.json` with a real walkthrough
   video before submitting.

## Open gaps before submitting

- **Privacy policy.** <https://zenuml.com/privacy/> does not mention the MCP
  server, Claude, ChatGPT, the stored Atlassian grant or tool-call analytics
  (checked 2026-10-17). OpenAI requires the policy to cover what the app
  accesses through ChatGPT. The README's *Data and privacy* section lists what
  the policy has to cover.
- **Reviewer account.** Both directories need credentials for a populated
  Confluence site with ZenUML installed. The robot account behind
  `ATLASSIAN_USERNAME` uses a one-time code, which ChatGPT review does not
  accept.
- **ChatGPT host test.** The diagram view has only been tested in claude.ai.
  Add the endpoint as a ChatGPT developer-mode connector and call
  `read_diagram` before submitting.
- **Sample data.** The ChatGPT test cases name an *Order checkout* diagram and a
  *Release process* page; create both on the reviewer site.
