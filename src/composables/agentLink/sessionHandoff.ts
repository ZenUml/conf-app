// src/composables/agentLink/sessionHandoff.ts
//
// Hands a live Agent Link session off from the inline macro iframe to the
// Forge Fullscreen modal iframe (spot-check finding #3, 2026-07-08 manual
// test): clicking "Connect to Agent" opens Fullscreen, but Fullscreen showed
// no token/prompt at all.
//
// Root cause: GenericViewer.vue's connectToAgent() calls startConnect() on
// THIS mount's useAgentLinkSession() instance, then opens Fullscreen via the
// EventBus 'fullscreen' -> forgeIndex.ts openModal() path. Forge boots
// Fullscreen as a SEPARATE Custom UI iframe — a fresh Vue app instance with
// its OWN useAgentLinkSession(), never the one that minted the token (see
// connectToAgent()'s existing comment, and relayClient.ts's "Fullscreen is a
// separate iframe" note). That fresh instance starts `idle`, so
// ConnectPanel — which only renders content for 'waiting' / 'connected' /
// 'timeout' — renders nothing.
//
// Fix: the inline instance persists {token, state, cloudId, pageId,
// contentId} to localStorage whenever that changes; the Fullscreen instance
// reads it back on mount and calls useAgentLinkSession's hydrateFrom() to
// display it — WITHOUT re-minting a token or opening a second relay
// WebSocket (design §3 decision #8: the inline instance keeps owning the one
// live connection; closing Fullscreen must not kill it, so Fullscreen must
// not open a rival one either).
//
// SAME-ORIGIN ASSUMPTION (load-bearing, NOT live-verified in this change):
// this only works if the inline macro iframe and the Fullscreen modal iframe
// share an origin, so a plain localStorage write in one is readable in the
// other. Evidence for this from the code (not a live check):
//   - Every module in manifest.yml — including this macro's own module and
//     every other Custom UI module — declares `resource: main`.
//   - forgeGlobal.ts's openModal() (the function GenericViewer.vue's
//     connectToAgent() -> EventBus 'fullscreen' -> forgeIndex.ts ultimately
//     calls) opens a `Modal` for the SAME app, and Forge serves one static
//     origin per Custom UI `resource` key — so the Fullscreen modal's iframe
//     and the inline macro's iframe are expected to be the same origin.
//   - This codebase already relies on localStorage working inside Forge
//     Custom UI iframes elsewhere (the paywall's per-domain/space/user
//     "continue editing" counter, and the sandbox preset mocks in
//     forgeGlobal.ts's applyPaywallSandboxMocks), with the same
//     degrade-to-no-op-via-try/catch posture used below.
// Confirming this LIVE (comparing `location.origin` in both iframes, or that
// a real Connect click actually shows the token in Fullscreen) is the
// coordinator's post-deploy spot check per the task brief. If the assumption
// is wrong, persistSession()/readSession() silently no-op and Fullscreen
// stays idle — i.e. today's bug, not a new failure mode.

import type { AgentLinkBoundContext } from './relayUrl'

export type AgentLinkHandoffState = 'waiting' | 'connected'

export interface AgentLinkHandoffSession extends AgentLinkBoundContext {
  token: string
  state: AgentLinkHandoffState
}

interface PersistedHandoff extends AgentLinkHandoffSession {
  persistedAt: number
}

// Ceiling on how old a handoff record may be before it's treated as absent.
// Matches the relay's own session token TTL ceiling (design §4.3 step 2:
// token TTL <=10 min) — a record older than this is from an
// already-expired relay session, so hydrating it into Fullscreen would just
// show a dead token instead of today's blank panel. Not a session-lifetime
// mechanism of its own; the relay's token TTL is the actual authority.
export const HANDOFF_TTL_MS = 10 * 60 * 1000

function storageKey(pageId: string): string {
  return `agentLinkSession:${pageId}`
}

export function persistSession(session: AgentLinkHandoffSession): void {
  try {
    const payload: PersistedHandoff = { ...session, persistedAt: Date.now() }
    localStorage.setItem(storageKey(session.pageId), JSON.stringify(payload))
  } catch (e) {
    console.warn('[agent-link] failed to persist session handoff', e)
  }
}

export function readSession(
  pageId: string,
  now: number = Date.now()
): AgentLinkHandoffSession | null {
  try {
    const raw = localStorage.getItem(storageKey(pageId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedHandoff>
    if (
      typeof parsed.persistedAt !== 'number' ||
      now - parsed.persistedAt > HANDOFF_TTL_MS ||
      !parsed.token ||
      !parsed.cloudId ||
      !parsed.pageId ||
      !parsed.contentId ||
      (parsed.state !== 'waiting' && parsed.state !== 'connected')
    ) {
      return null
    }
    return {
      token: parsed.token,
      cloudId: parsed.cloudId,
      pageId: parsed.pageId,
      contentId: parsed.contentId,
      state: parsed.state,
    }
  } catch (e) {
    console.warn('[agent-link] failed to read session handoff', e)
    return null
  }
}

export function clearSession(pageId: string): void {
  try {
    localStorage.removeItem(storageKey(pageId))
  } catch (e) {
    console.warn('[agent-link] failed to clear session handoff', e)
  }
}
