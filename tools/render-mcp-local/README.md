# ZenUML render MCP, local

A stdio MCP server with the same `render_diagram` tool as `https://zenuml.com/mcp`. It runs on the user's machine, so a diagram's source is checked and returned locally and is **not sent to ZenUML**.

The host draws the result with the MCP Apps view loaded from `https://zenuml.com`. That is the same view the public server uses.

## Use

Build it from the repository root after `pnpm install`:

```sh
node tools/render-mcp-local/build.mjs
```

Then register `dist/cli.mjs` as a stdio server. For Claude Code:

```sh
claude mcp add zenuml-local -- node /path/to/conf-app/tools/render-mcp-local/dist/cli.mjs
```

For Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "zenuml-local": { "command": "node", "args": ["/path/to/conf-app/tools/render-mcp-local/dist/cli.mjs"] } } }
```

The bundle leaves the parsers (`@zenuml/core`, `mermaid`, `linkedom`, `js-yaml`) as runtime dependencies. Inside this repository they come from the root `node_modules`. A published package would install them from `package.json`. The package is `private` until we decide to publish it.

`ZENUML_VIEW_ORIGIN` points the view at another deployment, such as the render Worker preview. It must use https, or http on localhost.

## What reaches zenuml.com

| Request | Contains |
| --- | --- |
| `GET /mcp-app/view.html` (by this process, on `resources/read`) | Nothing about the diagram |
| `GET /mcp-app/assets/*`, and for Graph `GET /drawio/*` (by the host's frame) | Nothing about the diagram. The renderer chunk that loads reveals the diagram **type** |
| `POST /mcp/view-event` (by the view) | Enum-only render, zoom and fullscreen events (`functions/agent-link/viewEvent.ts`). These events cannot tell a local server from the public one |

The source itself travels only from the agent to the host, to this process, back to the host and into the view's iframe. This process sends no analytics.

## Code

- `src/server.ts`: the JSON-RPC handler and the newline-delimited stdio transport.
- The tool, parse check, DSL guides and view resource are shared with the public Worker: `functions/agent-link/renderTool.ts`, `dslGuides.ts` and `oauth/mcpApps.ts`.
- `src/server.spec.ts` runs with the root unit tests (`pnpm exec vitest run tools/render-mcp-local`).
