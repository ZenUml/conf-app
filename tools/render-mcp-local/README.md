# ZenUML render MCP, local

A stdio MCP server with the same `render_diagram` tool as `https://zenuml.com/mcp`. It runs on the user's machine, so a diagram's source is checked and returned locally and is **not sent to ZenUML**.

The host draws the result with the MCP Apps view loaded from `https://zenuml.com`. That is the same view the public server uses.

## Use

From npm, with no checkout. For Claude Code:

```sh
claude mcp add zenuml-local -- npx -y @zenuml/render-mcp
```

For Claude Desktop (`claude_desktop_config.json`):

```json
{ "mcpServers": { "zenuml-local": { "command": "npx", "args": ["-y", "@zenuml/render-mcp"] } } }
```

### From a checkout

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

The bundle leaves the parsers (`@zenuml/core`, `mermaid`, `linkedom`, `js-yaml`) as runtime dependencies. Inside this repository they come from the root `node_modules`. The published package installs them from `package.json`.

`ZENUML_VIEW_ORIGIN` points the view at another deployment, such as the render Worker preview. It must use https, or http on localhost.

## What reaches zenuml.com

| Request | Contains |
| --- | --- |
| `GET /mcp-app/view.html` (by this process, on `resources/read`) | Nothing about the diagram |
| `GET /mcp-app/assets/*`, and for Graph `GET /drawio/*` (by the host's frame) | Nothing about the diagram. The renderer chunk that loads reveals the diagram **type** |
| `POST /mcp/view-event` (by the view) | Enum-only render, zoom and fullscreen events (`functions/agent-link/viewEvent.ts`). These events cannot tell a local server from the public one |

The source itself travels only from the agent to the host, to this process, back to the host and into the view's iframe. This process sends no analytics. From 0.1.3 its results carry `mcpMode: 'local'`, so the view's events record `mcp_mode: 'local'` and local use can be counted apart from the remote server.

## Code

- `src/server.ts`: the JSON-RPC handler and the newline-delimited stdio transport.
- The tool, parse check, DSL guides and view resource are shared with the public Worker: `functions/agent-link/renderTool.ts`, `dslGuides.ts` and `oauth/mcpApps.ts`.
- `src/server.spec.ts` runs with the root unit tests (`pnpm exec vitest run tools/render-mcp-local`).

## Release to npm

1. Change `version` in `package.json` and merge that to `main`.
2. Push the tag `render-mcp-v<version>` on that `main` commit.

`.github/workflows/render-mcp-npm-publish.yml` then tests, builds, installs the packed tarball, draws one diagram with it and publishes. It signs in to npm with Trusted Publishing (OIDC), so the repository holds no npm token. npm trusts the repository together with that workflow file name: if the file is renamed, update the trusted publisher of the package on npmjs.com (`npm trust list @zenuml/render-mcp` shows the current one).

## License

Apache-2.0, the same license as this repository. See `LICENSE`.
