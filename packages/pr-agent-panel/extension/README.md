# ZenUML PR Agent Panel — Chrome extension

WXT + Vue 3, Manifest V3, Chrome ≥ 116. Package overview, protocol and security model:
[`../shared/README.md`](../shared/README.md).

## What it does on github.com

- **Left review list** (`src/ui/ReviewList.vue`) on `/<owner>/<repo>/pull/<n>` pages, a 320 px
  column at the far left of the page, from the bottom of the repository tabs to the bottom of
  the window, as in Figma 184:5402. Below 1920 px wide the repository content is padded right
  by 320 px so the list never covers GitHub UI (`src/pr/page-column.ts`). Only PRs with a completed AI review, in the Hub's order, no count.
  Click a row to open that PR.
- **Agent Panel** (`src/ui/AgentPanel.vue`), bottom right, also on `/<owner>/<repo>/pulls`
  (there it shows only "No pull request"). TemPad Dev's panel, transcribed from the reference
  prototype: MCP badge, task row with Stop / Done, Preferences → Agent integration, current PR,
  latest review, messages to the agent.
- **Background broker** (`entrypoints/background.ts`, `src/bridge/broker.ts`) owns the one Hub
  connection (`src/bridge/hub-client.ts`) and talks to pages over `pr-panel` runtime ports.
- **Options page** (`entrypoints/options/`): Hub status, "Enable MCP access" (requests the
  optional `http://127.0.0.1/*` permission), agent setup, preferences.

MCP access is **off** by default: until the user enables it on the options page the extension
never probes local ports.

## Commands (from the repo root)

```bash
pnpm --filter @zenuml/pr-panel-extension prepare:wxt   # generates .wxt/ (tsconfig, types)
pnpm --filter @zenuml/pr-panel-extension test          # vitest + jsdom
pnpm --filter @zenuml/pr-panel-extension typecheck     # vue-tsc
pnpm --filter @zenuml/pr-panel-extension build         # → extension/.output/chrome-mv3
pnpm --filter @zenuml/pr-panel-extension dev           # watch build + auto-reload
```

## Load it in Chrome

1. `pnpm --filter @zenuml/pr-panel-extension build`
2. `chrome://extensions` → Developer mode → **Load unpacked** →
   `packages/pr-agent-panel/extension/.output/chrome-mv3`
3. Extension **Details → Extension options** (or the panel's **Set up agents**) →
   **Enable MCP access**, and accept the permission prompt.
4. Start an agent with the plugin: `claude --plugin-dir "$PWD/packages/pr-agent-panel/agent-plugin"`.
5. Open a pull request on github.com.

## Visual check against the Figma references

`entrypoints/preview.html` renders the real components in the ten reference states (Figma
184:6368) with fixture data. After loading the unpacked extension, open
`chrome-extension://<extension-id>/preview.html` (the id is on `chrome://extensions`).

## Testing notes

- `vitest.config.ts` does **not** use `WxtVitest()`: in WXT 0.21 that plugin's `resolveId`
  relies on Vite ≥ 6.3 hook filters, while Vitest 2.1 runs Vite 5.4, so every import resolved to
  WXT's setup module ("No test suite found"). The config aliases `wxt/browser` to WXT's fake
  browser and stubs the `browser` / `chrome` globals in `vitest.setup.ts` instead, and adds
  `@vitejs/plugin-vue` (resolved from the repo root) because `WxtVitest()` never added it.
- `src/pr/__fixtures__/pr-page.html` is a logged-out github.com PR page (fetched 2026-10-23)
  reduced to the layout skeleton: no scripts, styles, comments or text; placeholder title.
- `postcss.config.mjs` stops PostCSS from picking up the repo root's Tailwind config.
