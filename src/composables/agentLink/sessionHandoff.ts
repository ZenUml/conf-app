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
// Bug 2 (spot-check #3, 2026-07-09, real cross-iframe topology): the record
// above carried no `expiresAt` and no activity feed, so the Fullscreen rail
// showed no TTL countdown and no discovery rows even though the inline
// instance's own state had both — display-only plumbing that never reached
// the second iframe. `expiresAt` (absolute epoch ms) and a bounded `feed`
// snapshot (HANDOFF_FEED_MAX_ENTRIES, refreshed on every persistSession()
// call) now travel on the same record for exactly that reason.
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

// 'suspended' (Track G): the relay socket dropped unexpectedly — see
// useAgentLinkSession.ts's handleRelayStateEvent 'close' branch. Mint failure
// states are mirrored too so the separate Fullscreen iframe can show a notice
// even when no usable token was minted.
// #314: 'expired' — the client-side TTL watchdog (useAgentLinkSession.ts's
// scheduleExpiry()/handleExpired()) moved the relay owner's FSM to 'expired'.
// Mirrored here so a Fullscreen instance that hydrates this record also
// leaves whatever live variant it was showing instead of staying stuck.
export type AgentLinkHandoffState =
  | 'waiting'
  | 'connected'
  | 'suspended'
  | 'recovery_exhausted'
  | 'incompatible'
  | 'already_linked'
  | 'failed'
  | 'expired'

// Perceived-latency cue carried across the iframe boundary (charter §6 Track
// F). The relay owner (inline macro) is the only instance that receives an
// agent op, so the Fullscreen modal — a SEPARATE iframe that hydrates
// display-only — can only learn "an op is in flight / it just failed" if the
// owner republishes it here. Omitted (undefined) means idle: a record without
// this field keeps its exact pre-Track-F shape, so the success path
// (dsl republish) and the connected handshake persist unchanged.
//   'thinking' — an update_diagram op is in flight → Fullscreen shows shimmer.
//   'error'    — the last op failed/timed out → Fullscreen shows the error cue
//                then auto-clears (never a stuck shimmer on the modal either).
export type AgentLinkHandoffThinking = 'thinking' | 'error'

// Activity-feed row shape carried on the handoff record (bug 2, spot-check
// #3, 2026-07-09: the Fullscreen rail showed no TTL meter and no discovery
// feed rows in the real cross-iframe topology). Structurally identical to
// useAgentLinkSession.ts's own `AgentLinkActivityEntry` — defined here
// rather than imported from there because useAgentLinkSession.ts already
// imports FROM this module (importing back would cycle).
export interface AgentLinkHandoffFeedEntry {
  summary: string
  at: number
}

// Ceiling on how many recent feed rows travel on the handoff record. The
// owner's own (unbounded, in-memory) activityFeed ref can grow for the whole
// session lifetime; only this cross-iframe snapshot is capped, so every
// persistSession() write stays small regardless of session length. 20 rows
// is generous for a rail that only shows a handful at a time (ConnectPanel's
// feed list) while keeping the localStorage payload bounded.
export const HANDOFF_FEED_MAX_ENTRIES = 20

export interface AgentLinkHandoffSession extends AgentLinkBoundContext {
  token: string
  state: AgentLinkHandoffState
  // Latest agent-applied diagram DSL. Carried on the handoff record so the
  // Fullscreen modal — a SEPARATE iframe/Vue-store that never owns the relay
  // socket (design §3 decision #8) — can re-render an agent edit LIVE, and so
  // a Fullscreen opened AFTER edits already happened shows current state
  // rather than the original. Absent on the initial waiting/connected records
  // (no edit yet); present once the relay owner republishes an edit here.
  dsl?: string
  // "AI is thinking" surface state mirrored to the Fullscreen iframe (Track
  // F). Absent ⇒ idle. See AgentLinkHandoffThinking above.
  thinking?: AgentLinkHandoffThinking
  // Absolute epoch ms when the relay-minted token expires — mirrors
  // useAgentLinkSession.ts's own `expiresAt` ref so the Fullscreen instance's
  // TTL meter / countdown chip (SessionTtl.vue, ConnectPanel.vue) has
  // something to render even though it never minted the token itself. Bug 2
  // fix (spot-check #3): previously this never left the minting instance, so
  // the Fullscreen rail's TTL meter was always blank. Absent when the mint
  // result carried no expiresInSec, or before the mint resolves.
  expiresAt?: number
  // Absolute epoch ms for the newest relay op/status/edit signal observed by
  // the owning composable. Mirrored so a display-only Fullscreen instance can
  // derive the activity pulse/resting copy without owning the relay socket.
  lastActivityAt?: number
  // Recent activity-feed rows (connect/edit/suspend/resume/search/list/read),
  // bounded to the last HANDOFF_FEED_MAX_ENTRIES — mirrors
  // useAgentLinkSession.ts's own (unbounded, owner-only) `activityFeed` ref.
  // Bug 2 fix (spot-check #3): discovery ops (search_diagrams/list_diagrams/
  // read_diagram) never published to the handoff record at all, so the
  // Fullscreen rail's feed was empty no matter what the agent did.
  // Refreshed on every persistSession() call (persistSession itself performs
  // the bounding — see below), so it always reflects the owner's latest rows.
  feed?: AgentLinkHandoffFeedEntry[]
  // Amendment D (honest already-linked countdown): epoch ms when the existing
  // per-diagram lock releases, carried on an 'already_linked' record so the
  // Fullscreen instance can mirror an honest countdown (useAgentLinkSession.ts's
  // `alreadyLinkedUntil` ref) via hydrateFrom. Absent on every other record.
  lockExpiresAt?: number
  // Amendment F (sliding-TTL cap honesty): the DO's status envelope reported
  // the 60-min absolute cap now bounds the deadline (vs. the 10-min idle
  // window). Mirrored across the iframe so the Fullscreen rail's TTL meter — a
  // display-only hydrated instance that never receives the DO status envelope
  // directly — can stop claiming the session still "extends while your agent
  // works" once further bumps no longer move the deadline (SessionTtl.vue).
  // Absent ⇒ not (yet) capped.
  hitCap?: boolean
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
    const payload: PersistedHandoff = {
      ...session,
      // Single point that enforces the bound — callers just pass their
      // current (unbounded) in-memory feed and this trims it to the last
      // HANDOFF_FEED_MAX_ENTRIES on every write ("refreshed on each persist").
      feed: session.feed ? session.feed.slice(-HANDOFF_FEED_MAX_ENTRIES) : session.feed,
      persistedAt: Date.now(),
    }
    localStorage.setItem(storageKey(session.pageId), JSON.stringify(payload))
  } catch (e) {
    console.warn('[agent-link] failed to persist session handoff', e)
  }
}

// Shared validity check used by both the single-key read (readSession) and
// the scan-every-key read (readAnySession) below — a record is only usable
// once it has all required fields, a recognized state, and isn't older than
// HANDOFF_TTL_MS. Mint-failure records carry the pending local token purely as
// a handoff marker; ConnectPanel does not display it for those states.
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
    (parsed.state === 'waiting' ||
      parsed.state === 'connected' ||
      parsed.state === 'suspended' ||
      parsed.state === 'recovery_exhausted' ||
      parsed.state === 'incompatible' ||
      parsed.state === 'already_linked' ||
      parsed.state === 'failed' ||
      parsed.state === 'expired')
  )
}

function toHandoffSession(parsed: PersistedHandoff): AgentLinkHandoffSession {
  return {
    token: parsed.token,
    cloudId: parsed.cloudId,
    pageId: parsed.pageId,
    contentId: parsed.contentId,
    state: parsed.state,
    // Optional; only present once the relay owner has republished an edit.
    dsl: typeof parsed.dsl === 'string' ? parsed.dsl : undefined,
    // Optional; only present while an op is in flight or just failed (Track F).
    // Anything other than the two known values normalizes to idle (undefined).
    thinking:
      parsed.thinking === 'thinking' || parsed.thinking === 'error'
        ? parsed.thinking
        : undefined,
    // Optional; absent on a pre-bug-2 record or a mint with no expiresInSec.
    expiresAt: typeof parsed.expiresAt === 'number' ? parsed.expiresAt : undefined,
    // Optional; absent before PR2's activity display layer existed.
    lastActivityAt: typeof parsed.lastActivityAt === 'number' ? parsed.lastActivityAt : undefined,
    // Optional; absent on a pre-bug-2 record. Re-bounded defensively in case
    // a record was ever written by a future/older build with a looser cap.
    feed: Array.isArray(parsed.feed) ? parsed.feed.slice(-HANDOFF_FEED_MAX_ENTRIES) : undefined,
    // Amendment D: only present on an already_linked record that carried a lock
    // release time.
    lockExpiresAt: typeof parsed.lockExpiresAt === 'number' ? parsed.lockExpiresAt : undefined,
    // Amendment F: only present once the DO reported the deadline is cap-bound.
    hitCap: typeof parsed.hitCap === 'boolean' ? parsed.hitCap : undefined,
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
// The poll stops once a connected session is found (or the poll window
// elapses), but the storage listener remains until the caller unsubscribes:
// Fullscreen may first hydrate a waiting record, then receive the connected
// update after the relay owner sees the agent's first op.
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
  let lastDeliveredFingerprint: string | null = null
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
    // `dsl` is part of the fingerprint so a dsl-ONLY update (an agent edit,
    // where state stays 'connected' and only the diagram body changes) is
    // seen as new and delivered — without it, the second and later edits
    // would collapse to the same fingerprint and never reach the Fullscreen
    // modal (that was the ISSUE-1 live-render gap).
    const fingerprint = [
      session.cloudId,
      session.pageId,
      session.contentId,
      session.token,
      session.state,
      session.dsl ?? '',
      // `thinking` is part of the fingerprint so a thinking-ONLY change (the op
      // begins/fails while state stays 'connected' and the dsl hasn't changed
      // yet) is seen as fresh and delivered to the Fullscreen modal — without
      // it, the shimmer would never light up on that surface (Track F).
      session.thinking ?? '',
      // `expiresAt` + `feed` follow the exact same reasoning (bug 2, spot-check
      // #3): a search/list/read op republishes ONLY the feed (state/dsl/
      // thinking unchanged), and a mint result's expiry can arrive on a record
      // that otherwise looks identical to the one just delivered. Without
      // these in the fingerprint, discovery rows and the TTL value would
      // silently never reach the Fullscreen modal even though the owner
      // persisted them.
      session.expiresAt != null ? String(session.expiresAt) : '',
      session.lastActivityAt != null ? String(session.lastActivityAt) : '',
      session.feed ? JSON.stringify(session.feed) : '',
      // Amendment D/F: an already_linked lock time and the cap flag can each
      // change on a record that otherwise looks identical (the notice countdown
      // and the "extends while your agent works" hint depend on them), so both
      // must be in the fingerprint to reach the Fullscreen modal.
      session.lockExpiresAt != null ? String(session.lockExpiresAt) : '',
      session.hitCap != null ? String(session.hitCap) : '',
    ].join('\n')
    if (fingerprint !== lastDeliveredFingerprint) {
      lastDeliveredFingerprint = fingerprint
      onSession(session)
    }
    // Reaching 'connected' wins the mint-vs-mount race, so the bounded POLL
    // fallback can stop — but the storage LISTENER must stay live: agent
    // edits arrive later as dsl-only updates to this same 'connected' record,
    // and the Fullscreen modal re-renders them off those storage events.
    // Do NOT set `settled` here — that flag short-circuits every subsequent
    // tryDeliver (it's reserved for unsubscribe), which would drop all later
    // edits. Stopping only the poll is the correct, narrower action.
    if (session.state === 'connected') {
      stopPolling()
    }
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
