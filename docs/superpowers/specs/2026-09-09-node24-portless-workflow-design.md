# Node 24 and Portless Development Workflow Design

## Goal

Make every supported local and CI execution path use Node.js 24, then make the
local frontend and backend safe to run concurrently from multiple worktrees by
routing them through Portless names instead of fixed public ports.

## Phase 1: Node.js 24 toolchain

- Pin developer environments to Node.js 24.20.0 in `.node-version` and Volta.
- Require Node.js 24 through `package.json` engines.
- Run Forge functions on the recommended `nodejs24.x` runtime.
- Keep every GitHub Actions job on Node.js 24, including Forge deployment jobs.
- Upgrade `@forge/cli` from 12.20.1 to 13.5.0 before removing the Node.js 20
  deployment workaround. Forge CLI 13.5 uses Undici rather than the old direct
  `node-fetch` dependency implicated in the workaround.
- Leave `@forge/api` and `@forge/bridge` unchanged. Their major-version upgrades
  are application SDK migrations, not prerequisites for Node.js 24.

Validation consists of dependency installation, version checks, Forge lint,
unit tests, production builds, and static inspection of workflow/runtime pins.
Actual Forge deployment remains delegated to staging CI.

## Phase 2: Portless local workflow

- Wrap the frontend and Wrangler development servers with Portless.
- Derive stable frontend and API hostnames from the worktree so parallel
  worktrees do not compete for ports.
- Supply the Portless API URL to Vite's backend proxy.
- Resolve local Playwright base URLs through Portless instead of port 8080.
- Expose discoverability commands based on `portless get` and `portless list` so
  both humans and AI agents can determine the active URL without parsing logs.
- Run the shared proxy over plain HTTP on unprivileged port 1355. This preserves
  unattended agent startup without sudo or certificate prompts; each routed app
  still receives an independent random internal port.

Phase 2 begins only after Phase 1 passes its validation gates.
