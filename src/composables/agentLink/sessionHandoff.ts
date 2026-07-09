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

const STORAGE_KEY_PREFIX = 'agentLinkSession:'

function storageKey(pageId: string): string {
  return `${STORAGE_KEY_PREFIX}${pageId}`
}

export function persistSession(session: AgentLinkHandoffSession): void {
  try {
    const payload: PersistedHandoff = { ...session, persistedAt: Date.now() }
    localStorage.setItem(storageKey(session.pageId), JSON.stringify(payload))
  } catch (e) {
    console.warn('[agent-link] failed to persist session handoff', e)
  }
}

// Shared validity check used by both the single-key read (readSession) and
// the scan-every-key read (readAnySession) below — a record is only usable
// once it has all required fields, a recognized state, and isn't older than
// HANDOFF_TTL_MS.
function isValidPersisted(
  parsed: Partial<PersistedHandoff> | null | undefined,
  now: number
): parsed is PersistedHandoff {
  return (
    !!parsed &&
    typeof parsed.persistedAt === 'number' &&
    now - parsed.persistedAt <= HANDOFF_TTL_MS &&
    !!parsed.token &&
    !!parsed.cloudId &&
    !!parsed.pageId &&
    !!parsed.contentId &&
    (parsed.state === 'waiting' || parsed.state === 'connected')
  )
}

function toHandoffSession(parsed: PersistedHandoff): AgentLinkHandoffSession {
  return {
    token: parsed.token,
    cloudId: parsed.cloudId,
    pageId: parsed.pageId,
    contentId: parsed.contentId,
    state: parsed.state,
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
    if (!isValidPersisted(parsed, now)) return null
    return toHandoffSession(parsed)
  } catch (e) {
    console.warn('[agent-link] failed to read session handoff', e)
    return null
  }
}

// Fullscreen-without-a-pageId fallback (2026-07-09 live spot-check, finding
// #4): the Fullscreen modal iframe's boot doesn't always go through the
// apWrapper-backed bridge setup that resolves a `boundContext.pageId` (see
// GenericViewer.vue's mounted() comment). Rather than block hydration on
// that resolution, scan every `agentLinkSession:*` key in this same-origin
// localStorage and return the freshest still-live one. There is normally
// exactly one active session per tenant browser session, so "freshest
// valid record, any pageId" is an acceptable stand-in for "the record for
// THIS pageId" when the latter isn't available.
export function readAnySession(now: number = Date.now()): AgentLinkHandoffSession | null {
  try {
    let freshest: PersistedHandoff | null = null
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.startsWith(STORAGE_KEY_PREFIX)) continue
      let parsed: Partial<PersistedHandoff>
      try {
        parsed = JSON.parse(localStorage.getItem(key) ?? '') as Partial<PersistedHandoff>
      } catch {
        continue
      }
      if (!isValidPersisted(parsed, now)) continue
      if (!freshest || parsed.persistedAt > freshest.persistedAt) {
        freshest = parsed
      }
    }
    return freshest ? toHandoffSession(freshest) : null
  } catch (e) {
    console.warn('[agent-link] failed to scan for any session handoff', e)
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

// --- Reactive handoff (mint-vs-mount race, 2026-07-09 live spot-check) -----
//
// readSession() above is a ONE-SHOT read. GenericViewer.vue's mounted() calls
// it exactly once when the Fullscreen instance boots — but the inline
// instance's token mint (startConnect()'s requestSession().then(...)) is
// async, and Fullscreen can (and, per the live probe, reliably does) finish
// booting and call readSession() BEFORE that mint resolves and persists
// anything. The one-shot read then permanently sees null: nothing re-reads
// localStorage afterwards, so the rail stays idle/empty even though the
// inline instance persists the real session a moment later.
//
// subscribeToHandoff() below closes that gap by making the read reactive:
//   1. A same-origin `storage` event listener. The DOM fires `storage` in
//      OTHER documents that share the same origin when one of them writes
//      localStorage (it does NOT fire in the writing document itself) —
//      exactly the inline-writes/Fullscreen-listens shape of this handoff.
//   2. A short bounded poll (default 400ms, up to 8s) as a fallback in case
//      the `storage` event is ever missed or unsupported in the Forge Custom
//      UI sandbox — belt-and-suspenders, since the whole point of this fix
//      is reliability, not just "it works when the event fires".
// Both stop themselves the instant a valid session is found (or the poll
// window elapses); the caller is still responsible for calling the returned
// unsubscribe function on unmount/disconnect so nothing leaks.
export interface HandoffSubscriptionOptions {
  pollIntervalMs?: number
  pollTimeoutMs?: number
}

export const DEFAULT_HANDOFF_POLL_INTERVAL_MS = 400
export const DEFAULT_HANDOFF_POLL_TIMEOUT_MS = 8000

// Shared by subscribeToHandoff/subscribeToAnyHandoff below: both wire up the
// same same-origin `storage` event + bounded poll shape, differing only in
// (a) how they re-read (a specific pageId vs. scanning every key) and (b)
// which storage-event keys they consider relevant.
function subscribeToHandoffCore(
  read: () => AgentLinkHandoffSession | null,
  matchesKey: (key: string | null) => boolean,
  onSession: (session: AgentLinkHandoffSession) => void,
  options: HandoffSubscriptionOptions
): () => void {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_HANDOFF_POLL_INTERVAL_MS
  const pollTimeoutMs = options.pollTimeoutMs ?? DEFAULT_HANDOFF_POLL_TIMEOUT_MS

  let settled = false
  let pollHandle: ReturnType<typeof setInterval> | null = null
  let pollDeadline: ReturnType<typeof setTimeout> | null = null

  function stopPolling(): void {
    if (pollHandle !== null) {
      clearInterval(pollHandle)
      pollHandle = null
    }
    if (pollDeadline !== null) {
      clearTimeout(pollDeadline)
      pollDeadline = null
    }
  }

  // Shared by both triggers (storage event + poll tick): re-reads via `read`
  // rather than trusting the raw event payload, so a stale or
  // partially-written record is rejected the same way the initial one-shot
  // read already rejects it.
  function tryDeliver(): void {
    if (settled) return
    const session = read()
    if (!session) return
    settled = true
    stopPolling()
    onSession(session)
  }

  function handleStorage(e: StorageEvent): void {
    // e.key is null for localStorage.clear() — re-check regardless since
    // that can't produce a valid session anyway; tryDeliver's read() call is
    // the actual authority.
    if (!matchesKey(e.key)) return
    tryDeliver()
  }

  try {
    window.addEventListener('storage', handleStorage)
  } catch (e) {
    console.warn('[agent-link] failed to subscribe to storage event', e)
  }

  pollHandle = setInterval(tryDeliver, pollIntervalMs)
  pollDeadline = setTimeout(stopPolling, pollTimeoutMs)

  return function unsubscribe(): void {
    settled = true
    stopPolling()
    try {
      window.removeEventListener('storage', handleStorage)
    } catch (e) {
      console.warn('[agent-link] failed to unsubscribe from storage event', e)
    }
  }
}

export function subscribeToHandoff(
  pageId: string,
  onSession: (session: AgentLinkHandoffSession) => void,
  options: HandoffSubscriptionOptions = {}
): () => void {
  const key = storageKey(pageId)
  return subscribeToHandoffCore(
    () => readSession(pageId),
    (k) => k === null || k === key,
    onSession,
    options
  )
}

// Reactive counterpart to readAnySession() — same mint-vs-mount race fix as
// subscribeToHandoff(), for the pageId-less Fullscreen path (finding #4).
export function subscribeToAnyHandoff(
  onSession: (session: AgentLinkHandoffSession) => void,
  options: HandoffSubscriptionOptions = {}
): () => void {
  return subscribeToHandoffCore(
    () => readAnySession(),
    (k) => k === null || k.startsWith(STORAGE_KEY_PREFIX),
    onSession,
    options
  )
}
