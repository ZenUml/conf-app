// Shared SessionRegistry singleton for the Live Agent Link relay.
// See docs/superpowers/specs/2026-07-08-live-agent-link-design.md §5.2.
//
// TODO(agent-link): in production `session.ts` (macro mints a token) and
// `mcp.ts` (agent presents that token) run as separate Cloudflare Pages
// Function invocations that may land on different Worker isolates, so a
// module-level singleton cannot pair them for real traffic. The
// AgentLinkSession Durable Object (`AgentLinkSession.ts`) is where this
// registry's logic ultimately needs to live, keyed by token, so every request
// for a given session is routed to the same DO instance. This singleton
// exists only so unit tests (and local dev, which runs everything in one
// Miniflare process) can mint a token via `POST /agent-link/session` and then
// present it to `POST /agent-link/mcp` within the same process.

import { SessionRegistry } from './sessionRegistry';

export const sessionRegistry = new SessionRegistry();
