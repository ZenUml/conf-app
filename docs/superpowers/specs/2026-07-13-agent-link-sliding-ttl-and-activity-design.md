# Live Agent Link — Sliding Session TTL + Live Activity Feedback (Design)

> Status: **draft for review, v2**. Precursor to two implementation plans
> (writing-plans). Builds on `2026-07-08-live-agent-link-design.md` (the base
> feature) and the merged Agent Link PRs (#312–#322).
>
> **v2 (2026-07-13, Fable design review):** replaced three parallel mechanisms
> (op-envelope expiry stamping / client-inferred activity pulse / separate hook
> path) with **one relay-originated `status` envelope on the existing macro
> WebSocket**. Key insight: the macro WS is already a persistent server-push
> channel; v1 contorted around it. Also: the activity-bump condition widened
> from "delivered to macro" to "authenticated work request" (fixes
> guardrail-retry-loop death), and guardrail rejections — previously invisible
> to the user, the worst dead-air case — now surface through the same bus.

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

- Each **authenticated work request** resets the 10-minute idle window.
- The session can never live longer than 60 minutes total, no matter how active.
- Rationale: reconciles the request with design §8 / line 171 ("a leaked token
  only grants edit-this-one-diagram for a short window"). A stolen or abandoned
  token dies after ≤10 min idle or ≤60 min absolute.
- **Amended 2026-07-16 (review-amendments PR):** a **suspended** session's own
  retries do **not** bump. `bumpActivity` returns early while
  `state === 'suspended'` before any slide/re-arm/status push — the macro is
  gone (content deleted/moved), so an agent retrying against a macro-less
  session must not extend a session that has nothing left to attach to. The
  resume window shown to the user is the **remaining effective expiry at the
  moment of the drop**, not a freshly-bumped one.
- **"Authenticated work request"** (v2, was "delivered to the macro" in v1) =
  `tools/call` for any tool **except `get_status`**, plus `resources/read` (only
  ever the DSL guides — unambiguously diagram work). It deliberately **includes
  guardrail-rejected `update_diagram` calls**: a rejected edit is real agent
  engagement, and v1's delivered-only rule would have killed a session mid
  guardrail-retry-loop (>10 min of rejected attempts with no reads = dead
  session while the agent is actively working).
- **Not** bump-worthy: `get_status` (a passive monitor must not keep a dead
  session alive), `initialize` / `tools/list` / `notifications/*` (an MCP host
  fires these when the user starts *any* conversation, even unrelated to
  diagrams — they signal "host connected", not "user engaged").

## 4. Workstream A — Sliding TTL on a status bus (server-authoritative)

The Durable Object is the sole authority on expiry (it is what 403s the agent);
the client mirrors it, never computes its own.

**v2 architecture — one bus, three producers:**

```
DO observes                          DO pushes                Macro displays
───────────────────────────         ─────────────────        ──────────────────
auth traffic  (?bump=1)        →                             TTL meter re-arms
guardrail rejects (/activity)  →    {kind:'status',      →   activity pulse
hook turns    (/activity, WS-C)→     expiresAt, activity}     feed rows
```

- The macro's WebSocket is a persistent, bidirectional channel the DO can write
  to at any time (it already sends `error` envelopes). v2 adds **one
  relay-originated envelope kind, `status`**, carrying
  `{expiresAt, activity?: {type, detail?}}` — the single way the macro passively
  learns anything the DO knows.
- **Forwarded op envelopes stay verbatim** — no relay metadata is stamped into
  peer messages (v1's op-stamping mixed concerns; see §8).
- Backward compatible: `relayClient.handleMessage` already ignores unknown
  envelope kinds silently, so an old macro iframe receiving `status` is safe.

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

### 4.2 `functions/agent-link/AgentLinkSession.ts` (the DO) + `mcp.ts`

- Bootstrap: set `lastActivityMs = issuedAtMs`; set the alarm at
  `effectiveExpiryMs(…)`.
- **The bump rides the auth call that already happens** (zero extra
  round-trips): every MCP request round-trips `GET /session` on the DO for
  auth (`authenticateViaDo`). `mcp.ts` — which knows the JSON-RPC method —
  appends `?bump=1` when the request is bump-worthy per §3. The DO's
  `handleSessionInfo` then: bumps `lastActivityMs`, persists, **re-arms the
  alarm** to the new `effectiveExpiryMs`, and **pushes a `status` envelope to
  the macro socket** with the fresh `expiresAt`. `handleAgentOp` no longer
  needs its own bump.
- **Guardrail-reject visibility (new, closes a real blind spot):** guardrail
  rejection happens in `mcp.ts`/`mcpTools` *before* `forwardToMacro` — the
  macro never sees the op, so today the user watches the agent claim "updating
  the diagram" while **nothing appears in the UI** across an entire retry loop.
  v2: on a guardrail rejection, `mcp.ts` fires a best-effort
  `POST /activity {type:'guardrail_rejected', reason}` to the DO, which pushes
  a `status` envelope; the macro renders an honest feed row ("Agent submitted
  an invalid edit — retrying"). The same `/activity` ingress is what
  Workstream C's hooks use later — one door, not two.
- `validateSession`, `get_status` (`expiresInSec`), and the `suspended`
  `resume_deadline`: all derive from `effectiveExpiryMs(…)`.
- `alarm()`: guard with `isExpired(…)`; if a bump moved the deadline forward
  (the alarm is one-shot and replaced on each re-arm, so a stale fire is
  unlikely), re-arm to `effectiveExpiryMs` instead of expiring.
- `forwarding.ts`: add `status` to the Envelope union as a relay-originated,
  never-routed kind (macro-bound only).
- **Deploy order:** the companion Worker (`workers/agent-link/`, hosts the DO)
  deploys independently of Pages — ship the DO **first**, then Pages/mcp.ts.
  For the sliding-TTL/status-bus surface this is soft (`?bump=1` on an old DO is
  an ignored query param; a new DO with old Pages simply never gets bumps — both
  degrade to v1 fixed-TTL behavior, no breakage). **But the mint-at-idle change
  (§4.3, amended 2026-07-16) makes the ordering HARD:** new Pages minting the
  10-min lock while the prod DO still lacks `claimContentLockAtCap` does NOT
  degrade safely — the lock lapses at +10 min while a sliding session lives to
  +60 min, and a second concurrent mint for that `contentId` succeeds in the gap
  (two live sessions on one diagram, violating design §7 decision #2). The prod
  Worker deploy (`pnpm --filter agent-link deploy:prod`, human-gated per
  `.github/workflows/agent-link-worker-deploy.yml`) is therefore a **required
  precondition** of any prod app release carrying mint-at-idle.

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

**Amended 2026-07-16 (review-amendments PR):** mint-at-cap was rejected during
review. `session.ts`'s mint endpoint is **unauthenticated** (it runs before a
session exists) — claiming a 60-min lock there would let anyone grief a diagram
with a full-hour exclusivity lock just by hitting mint repeatedly, with no
session ever formed to justify it. Landed instead: **mint claims only the
10-min `IDLE_TTL_MS` lock**, and the DO **re-claims the lock up to the 60-min
cap on the first authenticated bootstrap** (`AgentLinkSession.ts`'s
`claimContentLockAtCap` — the DO owns the upgrade because by then a real
session exists to justify the longer hold). The re-claim is **best-effort**: a
failed re-claim just leaves the shorter 10-min lock in place to self-clear,
never blocking the agent's request; a **409 from a different owner** (the
10-min lock lapsed and another mint grabbed it in the gap) rolls the bootstrap
back and rejects the upgrade. Never-connected orphans (mint but no bootstrap)
now self-clear in ≤10 min instead of tying up a diagram for a full hour.

> **Deploy-order dependency (do not miss on release).** This split moves the
> lock's full-lifetime coverage out of the auto-deployed Pages Function
> (`session.ts`, ships with the normal app release) and into the DO
> (`claimContentLockAtCap`), which lives in the separately, human-gated
> `conf-agent-link` **Worker**. A prod app release that carries the 10-min mint
> while the prod Worker still runs a pre-amendment DO reopens exactly the
> two-sessions-on-one-`contentId` hole this section closes — the 10-min lock
> lapses mid-session and a second mint wins the gap. **Mitigation:** deploy the
> agent-link Worker to prod (`pnpm --filter agent-link deploy:prod`) BEFORE or
> WITH promoting Pages. This is codified in §4.2's Deploy-order note and in the
> mint claim's inline comment (`session.ts`); it is NOT enforced by CI (the
> Worker prod deploy is intentionally human-gated), so it is a release-runbook
> step, not an automated guarantee.

**Amended 2026-07-16 (review-amendments PR):** the DO's `diagram_already_linked`
409 body now carries `lock_expires_at` (the real epoch-ms the existing lock
releases), forwarded verbatim by `session.ts`'s mint endpoint and surfaced by
the client as `lockExpiresAt` (→ `alreadyLinkedUntil`). This feeds an
**honest** "another agent session holds this diagram — it expires in ~N min"
notice instead of a fabricated "started 4 min ago" line — a direct consequence
of the mint-at-cap → mint-at-idle/re-claim-at-cap change above: since the
lock's true expiry now depends on whether the DO ever re-claimed it, the client
can no longer guess a fixed retry window and must be told.

### 4.4 Client (`relayClient.ts` + `useAgentLinkSession.ts`)

- `relayClient.handleMessage`: handle `kind === 'status'` → emit a new
  `{type: 'status', expiresAt, activity?}` `RelayStateEvent`. (Op envelopes are
  unchanged/verbatim.)
- `handleRelayStateEvent` status branch: set `expiresAt.value`, call
  `scheduleExpiry()` (re-arm the watchdog), record the activity (pulse + feed
  row when `activity` is present), and re-persist the handoff. Fullscreen
  inherits the new deadline through the **existing** `hydrateFrom` `expiresAt`
  mirror (owner already persists `handoffFeedFields()`, which carries
  `expiresAt`) — no new plumbing.
- `SessionTtl.vue`: keep `totalSeconds = 600` (the idle window). The bar then
  **visibly refills** on each bump — a truthful "session just got extended"
  signal. Near the 60-min cap the remaining naturally falls below 10 min and the
  bar can't refill past the cap (correct).

## 5. Workstream B — Live activity feedback (Problem 1)

- **The pulse is a pure display of server-known facts** (v2 simplification):
  `agentActive = now - lastActivityAt < LINGER` where `lastActivityAt` updates
  on every incoming `op` **or** `status` envelope. No client-side state machine
  inferring liveness from op traffic, no settle-correlation, no debounce
  guesswork — the DO already knows; the client just renders it.
- **Do not touch `beginThinking()`** for non-`update_diagram` activity: it arms
  `renderSafetyTimer` expecting a paint (`notifyRenderSettled`), which a
  read/search never produces → the safety timer fires →
  `settleThinking('timeout')` → a **false "Agent stopped responding" error
  cue**. The render-measurement machine stays scoped to `update_diagram`; the
  activity pulse is orthogonal.
- **Resting state** on `AgentStatusHeader` / `LiveBadge`: `Connected · agent
  active` with a ticking "last active Xs ago" (reuse `SessionTtl.vue`'s 1-second
  ticker pattern), so between ops the panel reads alive, not frozen.
- **Guardrail rejects get a feed row** (via the §4.2 `status` push) — the
  previously-invisible retry loop becomes the panel's most informative moment
  instead of its most confusing silence.
  **Amended 2026-07-16 (review-amendments PR):** the feed copy reads
  `'⚠ Agent submitted an invalid edit — rejected'`, **not** "— retrying". The
  status push reports one rejection at a time and the relay cannot promise the
  agent will actually retry, so the row states only what demonstrably
  happened. The `ConnectPanel` feed classifier keys on the leading `⚠` to pin
  the row to the error tone/icon; a copy edit dropping it now fails a test.
  Companion copy changes landed in the same PR: `SessionTtl` says "Session
  expires in" (was "Token expires in") with a muted "extends while your agent
  works" hint suppressed once `atCap`; `ConnectPanel`'s setup block dropped the
  dead "Add to Cursor" button and "no-install bridge" link, its prompt's third
  line reads `# reads this page · edits this diagram · 10 min idle / 60 min
  max`, and the copy button surfaces a "Copy failed — select the text above"
  state.
- **Honest ceiling.** Pure reasoning gaps (no MCP request in flight) *cannot* be
  signaled over MCP's request/response transport without the agent host
  cooperating. This workstream does **not** fabricate a heartbeat or instruct
  the agent to spam a keepalive tool. The resting state covers the perception;
  that is the real fix within this transport. (The only way to truly signal
  reasoning time is Workstream C.)

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
- **Same bus, third producer (v2):** the Pages endpoint forwards to the DO's
  existing `/activity` ingress (§4.2 — already built for guardrail rejects in
  PR1), and the macro learns of the turn via the same `status` envelope it
  already handles. Workstream C adds **no new mechanism** — only a new
  activity producer and a hook snippet.
- **New Pages endpoint** must be added to `public/_routes.json` `include` (else
  Pages serves it as SPA HTML), and authed by the session token.
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
- **v1's op-envelope `expiresAt` stamping** (superseded in v2). Stamping relay
  metadata into forwarded peer messages mixed concerns (op envelopes should
  stay verbatim agent messages), only informed the macro on *delivered* ops
  (guardrail rejects and other non-forwarded activity stayed invisible), and
  required the client to infer liveness from op traffic. The `status` envelope
  subsumes it with one mechanism and fewer client moving parts.
- **Bump on every authenticated request including `initialize`/`tools/list`.**
  Rejected: an MCP host fires those when the user starts *any* conversation —
  they prove the host is connected, not that the user is engaged with the
  diagram. Bumping on them would let a merely-registered MCP server keep a
  session alive with zero real use.

## 9. Files & sequencing

**Server:** `sessionToken.ts`, `AgentLinkSession.ts` (bump-on-auth, `status`
push, `/activity` ingress), `session.ts`, `mcp.ts` (`?bump=1`, guardrail-reject
report), `forwarding.ts` (`status` envelope kind).
**Client:** `relayClient.ts`, `useAgentLinkSession.ts`,
`AgentStatusHeader.vue` / `LiveBadge.vue`, `SessionTtl.vue`,
`analytics/{catalog,types}.ts`.
**Workstream C (later):** new Pages endpoint `functions/agent-link/activity.ts`
(forwards to the DO ingress), `public/_routes.json`, DO `in_turn` state, a
Claude Code hook snippet + docs.

Unit specs alongside each changed module (`sessionToken.spec.ts` for
effective-expiry/isExpired/bump; `AgentLinkSession.spec.ts` for bump-on-auth +
cap + content-lock-at-cap + status push; `mcp.spec.ts` for `?bump=1` selection
+ guardrail report; `relayClient.spec.ts` for `status` envelope handling;
`useAgentLinkSession.spec.ts` for expiry re-arm + activity pulse). E2E
spot-check on lite-stg after — mind the 10-min per-`contentId` lock (fresh page
+ `--workers=1`, per `reference_agent_link_spotcheck_lock`).

**Sequencing — three deliverables:**

1. **PR1 — Sliding TTL + content-lock-at-cap + the status bus** (load-bearing).
   Server TTL, `?bump=1`, `status` envelope + client handler, guardrail-reject
   visibility, analytics. Deploy the companion Worker (DO) before Pages (§4.2).
2. **PR2 — Live activity display.** Pulse + resting state + badge + feed copy —
   thin now, pure display over the PR1 bus.
3. **PR3 (optional, later) — Claude Code hook enhancement layer.** A third
   producer on the same bus. Only if the reasoning-gap perception is a real
   observed pain after PR2.

PR2 depends on PR1 (the bus); PR3 depends on PR1 only.

## 10. Open questions

- Throttle rule for `agent_link_session_extended` (every N slides? once per
  minute?) — decided at PR1 planning.
- `LINGER` duration for the activity pulse (`now - lastActivityAt < LINGER`,
  ~a few seconds) — decided at PR2 planning.
- Whether a `status` push should also fire on bump-worthy auths for ops that
  ARE forwarded (the macro sees the op envelope itself moments later — the
  status push may be redundant there; pushing only on non-forwarded activity
  + a `status`-on-op-delivery expiry field is an alternative) — decided at PR1
  planning; either way the client handles both signals identically.
- Whether to keep `TOKEN_TTL_MS` as a deprecated alias during the rename or cut
  it cleanly — decided at PR1 planning (grep the callers).
