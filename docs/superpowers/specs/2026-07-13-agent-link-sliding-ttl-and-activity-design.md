# Live Agent Link — Sliding Session TTL + Live Activity Feedback (Design)

> Status: **draft for review**. Precursor to two implementation plans (writing-plans).
> Builds on `2026-07-08-live-agent-link-design.md` (the base feature) and the
> merged Agent Link PRs (#312–#322).

## 1. Problem (User-First Trace)

The user connects an external AI agent (Claude Code, Cursor, etc.) to a diagram
via Agent Link, then drives it from their own AI client. Two problems today:

1. **The macro UI shows no live reflection of agent activity while the AI is
   working.** The only "agent is working" cue (`thinkingState`) is lit
   **exclusively** by `update_diagram` ops (`useAgentLinkSession.ts` →
   `handleRelayStateEvent`: `if (event.op === 'update_diagram') beginThinking()`).
   Reads / searches / lists show nothing while in flight (only a feed row *after*
   completion), and during pure LLM reasoning between tool calls the relay
   receives nothing at all — so the panel reads as dead.

2. **The 10-minute token expires on a fixed schedule regardless of activity.**
   `isExpired` compares `now` to `issuedAtMs` only; the DO alarm and the client
   watchdog are both keyed to a static `issuedAtMs + 10min` deadline. A session
   that is actively being used still dies at the 10-minute mark.

## 2. Root cause

- **Problem 2 is an un-implemented part of the original design.** `design.md:102`
  specifies the DO holds `{… expiry, lastActivity}`, and lines 36/74/124
  distinguish **"token TTL"** from **"idle timeout (no activity N min)"**. The
  implementation collapsed both into one fixed `issuedAtMs + 10min` timer and
  dropped `lastActivity`. The user's request ("extend on each response") is
  literally "implement the idle-timeout that was designed and then dropped."
- **Problem 1** is a scoping gap: the live "working" cue was wired only to the
  one op that repaints the surface, and the transport (MCP request/response) has
  no signal for reasoning time.

## 3. Decided policy

**Idle 10 min + hard cap 60 min** (user decision, 2026-07-13):

```
effectiveExpiry(issuedAtMs, lastActivityMs)
  = min(lastActivityMs + IDLE_TTL_MS(10m),  issuedAtMs + MAX_SESSION_MS(60m))
```

- Each op **delivered to the macro** resets the 10-minute idle window.
- The session can never live longer than 60 minutes total, no matter how active.
- Rationale: reconciles the request with design §8 / line 171 ("a leaked token
  only grants edit-this-one-diagram for a short window"). A stolen or abandoned
  token dies after ≤10 min idle or ≤60 min absolute.
- **"Delivered to the macro"** is the activity condition (not "successful op"),
  so the server and the macro slide on the *same* event; the absolute cap — not
  op success — is what bounds a leaked token. `get_status` polling does **not**
  extend (an idle agent that only polls must not keep a dead session alive).

## 4. Workstream A — Sliding TTL (server-authoritative)

The Durable Object is the sole authority on expiry (it is what 403s the agent);
the client mirrors it, never computes its own.

### 4.1 `functions/agent-link/sessionToken.ts` (pure helpers)

- Replace the single `TOKEN_TTL_MS` with `IDLE_TTL_MS = 10*60*1000` and
  `MAX_SESSION_MS = 60*60*1000`.
- `SessionRecord` gains `lastActivityMs: number` (matches `design.md:102`
  `lastActivity`).
- New pure `effectiveExpiryMs(issuedAtMs, lastActivityMs): number` = the `min()`
  above.
- `isExpired(issuedAtMs, lastActivityMs, nowMs)` = `nowMs >= effectiveExpiryMs(…)`
  (signature change — update every caller).
- New pure `bumpActivity(record, nowMs)` → sets `lastActivityMs = nowMs`
  (the `min()` clamps the effect at the cap; no separate clamp needed).

### 4.2 `functions/agent-link/AgentLinkSession.ts` (the DO)

- Bootstrap: set `lastActivityMs = issuedAtMs`; set the alarm at
  `effectiveExpiryMs(…)`.
- `handleAgentOp`, for every real op **forwarded to the macro** (not
  `get_status`): bump `lastActivityMs = Date.now()`, persist, **re-arm the alarm**
  to the new `effectiveExpiryMs`, and **stamp the fresh authoritative `expiresAt`
  onto the forwarded op envelope**: `{kind:'op', id, op, payload, expiresAt}`.
  (This is how the macro learns the new deadline — see §4.4.)
- `validateSession`, `get_status` (`expiresInSec`), and the `suspended`
  `resume_deadline`: all derive from `effectiveExpiryMs(…)`.
- `alarm()`: guard with `isExpired(…)`; if a bump moved the deadline forward
  (the alarm is one-shot and replaced on each re-arm, so a stale fire is
  unlikely), re-arm to `effectiveExpiryMs` instead of expiring.

### 4.3 `functions/agent-link/session.ts` (content-lock — the load-bearing fix)

`session.ts` claims the per-`contentId` mint-exclusivity lock at
`Date.now() + TOKEN_TTL_MS` and **nothing ever refreshes it**. Under a sliding
TTL a session outlives its own lock → a second concurrent mint for the same
diagram succeeds → **two live sessions on one `contentId`** (violates
design §7 decision #2). Fix: **mint the lock at the absolute cap
(`Date.now() + MAX_SESSION_MS`).** It then covers the whole *possible* lifetime
and never needs refreshing; `releaseContentLock()` still frees it early on
close/expire. This is *why* the cap had to be finite — a no-cap policy could not
have a self-healing lock.

### 4.4 Client (`relayClient.ts` + `useAgentLinkSession.ts`)

- `RelayEnvelope` / `RelayStateEvent`: carry an optional `expiresAt`.
  `handleOp` reads `envelope.expiresAt` and includes it on the emitted
  `{type:'op', …}` event.
- `handleRelayStateEvent` op branch: if `event.expiresAt` is present, set
  `expiresAt.value = event.expiresAt`, call `scheduleExpiry()` (re-arm the
  watchdog), and re-persist the handoff. Fullscreen inherits the new deadline
  through the **existing** `hydrateFrom` `expiresAt` mirror (owner already
  persists `handoffFeedFields()`, which carries `expiresAt`) — no new plumbing.
- `SessionTtl.vue`: keep `totalSeconds = 600` (the idle window). The bar then
  **visibly refills** on each op — a nice, truthful "session just got extended"
  signal. Near the 60-min cap the remaining naturally falls below 10 min and the
  bar can't refill past the cap (correct).

## 5. Workstream B — Live activity feedback (Problem 1)

- **New lightweight `agentActivity` pulse, separate from the render-measurement
  state machine.** Do **not** reuse `beginThinking()` for non-`update_diagram`
  ops: it arms `renderSafetyTimer` expecting a paint (`notifyRenderSettled`),
  which a read/search never produces → the safety timer fires →
  `settleThinking('timeout')` → a **false "Agent stopped responding" error cue**.
  The pulse lights on **any** op-received and clears on op-settle, with a short
  lingering debounce so back-to-back ops stay lit.
- **Resting state** on `AgentStatusHeader` / `LiveBadge`: `Connected · agent
  active` with a ticking "last active Xs ago" (reuse `SessionTtl.vue`'s 1-second
  ticker pattern), so between ops the panel reads alive, not frozen.
- **Honest ceiling.** Pure reasoning gaps (no op in flight) *cannot* be signaled
  over MCP's request/response transport without the agent host cooperating. This
  workstream does **not** fabricate a heartbeat or instruct the agent to spam a
  keepalive tool. The resting state covers the perception; that is the real fix
  within this transport. (The only way to truly signal reasoning time is
  Workstream C.)

## 6. Workstream C — Host-side hook enhancement (OPTIONAL, Claude-Code-only, later)

The one true signal for "agent is mid-reasoning" lives **inside the agent host**
and is invisible to MCP — but a **host-side hook** is a side channel that *can*
observe it. Claude Code's `UserPromptSubmit` (turn start) + `Stop` (turn end)
hooks bracket a whole turn, including pure reasoning with zero tool calls.

- **Mechanism:** the hook `curl`s a new relay endpoint
  `POST /agent-link/activity?token=…` with `phase: turn_start | turn_end`.
  `turn_start` → set the DO `in_turn` flag + bump activity; `turn_end` → clear
  `in_turn`. While `in_turn`, the idle timer is paused (still bounded by the
  60-min cap). The macro shows "thinking" for the whole bracket.
- **New endpoint** must be added to `public/_routes.json` `include` (else Pages
  serves it as SPA HTML), and authed by the session token.
- **Caveats (why this is an optional enhancement layer, not the baseline):**
  1. **Host-specific.** Claude Code has these hooks (high confidence); Claude
     Desktop / Cursor generally do **not** expose an arbitrary-command
     user-prompt hook (medium-high confidence — verify before committing). It
     breaks Agent Link's host-agnostic "paste one prompt" model.
  2. **Setup friction + token rotation.** The token is short-lived and rotates
     per session, so the hook config must carry / dynamically read the current
     token.
  3. **`Stop` may not fire** (client crash/close) → the idle window is the
     required timeout fallback so "thinking" can't stick.
  4. The **60-min cap still applies** — hooks slide within it, never past it.
- **Recommendation:** ship as an opt-in snippet offered alongside the pasted
  prompt for Claude Code users. Not a requirement, not the primary mechanism.

## 7. Analytics (events-first — the first commit of each branch)

Per project rule (`CLAUDE.md`: "Plan Mixpanel events before implementing"):

- `agent_link_session_expired` (existing): add property
  `expiry_cause: 'idle' | 'absolute_cap'`.
- **New** `agent_link_session_extended` (throttled — *not* every op): props
  `feature_area`, `surface`, `macro_type`, `expires_in_sec`, `hit_cap: boolean`.
  Fired when a slide meaningfully extends the deadline.
- Register in `src/utils/analytics/catalog.ts` (`AnalyticsEventName` union) and
  `src/utils/analytics/types.ts` **before** any feature code.
- Workstream C (if built) adds `agent_link_turn_bracketed` (or reuses
  `agent_link_session_extended` with `source: 'hook'`) — decided when C is planned.

## 8. Rejected alternatives

- **Use the "user submits a prompt" event over MCP.** Impossible: our MCP server
  (`mcp.ts` `switch(body.method)`) only ever receives
  `initialize` / `notifications/*` / `tools/list` / `resources/*` / `tools/call`.
  MCP has no client→server "user sent a message" signal — the prompt is handled
  inside the host, invisible to tool servers. It sits in the *same* blind spot as
  the reasoning gap, so it cannot fill it. (A host-side **hook** — Workstream C —
  is a different, viable side channel.)
- **A cheap keepalive subagent that "keeps the connection alive".** Rejected: an
  LLM is a bad timer. (a) "Cheap" is false — each ping is a full model turn;
  cost accrues over 10–60 min. (b) LLMs have no native `sleep` → either spin hot
  or you've hand-built a cron out of an LLM. (c) Host-specific (needs
  subagent/background support). (d) **Semantically wrong** — a timer-blind
  background ping keeps a session alive regardless of real user engagement, i.e.
  the "pure sliding, no cap" option already rejected, implemented the most
  expensive way. It also adds *no* signal a hook doesn't give for free (a
  separate context knows *less* about the main agent's state than a hook that
  fires on the real event). Verdict: more expensive than a timer, less accurate
  than a hook.
- **Instruct the agent to call a keepalive tool each turn.** Rejected (advisor +
  analysis): models comply inconsistently, it burns a tool round-trip + tokens
  every turn, and it pollutes the tool surface — a fake heartbeat.
- **Pure sliding TTL, no cap.** Rejected on the §8 / line 171 security model and
  because the content-lock could not then self-heal.

## 9. Files & sequencing

**Server:** `sessionToken.ts`, `AgentLinkSession.ts`, `session.ts`.
**Client:** `relayClient.ts`, `useAgentLinkSession.ts`,
`AgentStatusHeader.vue` / `LiveBadge.vue`, `SessionTtl.vue`,
`analytics/{catalog,types}.ts`.
**Workstream C (later):** new `functions/agent-link/activity.ts`,
`public/_routes.json`, DO `in_turn` state, a Claude Code hook snippet + docs.

Unit specs alongside each changed module (`sessionToken.spec.ts` for
effective-expiry/isExpired/bump; `AgentLinkSession.spec.ts` for slide + cap +
content-lock-at-cap; `relayClient.spec.ts` for `expiresAt` propagation;
`useAgentLinkSession.spec.ts` for slide + activity pulse). E2E spot-check on
lite-stg after — mind the 10-min per-`contentId` lock (fresh page + `--workers=1`,
per `reference_agent_link_spotcheck_lock`).

**Sequencing — three deliverables, independent:**

1. **PR1 — Sliding TTL + content-lock-at-cap** (load-bearing). Server + client
   TTL, analytics.
2. **PR2 — Live activity feedback.** Activity pulse + resting state + badge.
3. **PR3 (optional, later) — Claude Code hook enhancement layer.** Only if the
   reasoning-gap perception is a real observed pain after PR2.

A does not depend on B; both are independent of C. PR1 and PR2 can also land
together if preferred.

## 10. Open questions

- Throttle rule for `agent_link_session_extended` (every N slides? once per
  minute?) — decided at PR1 planning.
- Debounce duration for the `agentActivity` pulse linger (~a few seconds) —
  decided at PR2 planning.
- Whether to keep `TOKEN_TTL_MS` as a deprecated alias during the rename or cut
  it cleanly — decided at PR1 planning (grep the callers).
