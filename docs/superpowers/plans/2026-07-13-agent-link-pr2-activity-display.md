# Agent Link PR2 — Activity Display Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox syntax.

**Goal:** The rail reads alive between ops: an activity pulse driven purely by server-known facts, a ticking resting state ("Connected · agent active · Xs ago"), and cross-iframe parity — the thin display layer over PR1's status bus (spec `2026-07-13-agent-link-sliding-ttl-and-activity-design.md` §5, §9 PR2).

**Architecture:** The composable tracks one new fact — `lastActivityAt` (ms epoch of the newest op/status/edit signal) — mirrors it over the existing handoff record, and exposes it. Components derive everything else: `agentActive = now - lastActivityAt < ACTIVITY_LINGER_MS` (pure function, 1-second ticker, no state machine). No server changes; no new envelope kinds.

**Tech Stack:** Vue 3 composition (script setup for components, options-style composable per existing files), Vitest.

## Global Constraints

- **Display only** — no relay/DO/mcp changes; PR1's wire protocol is frozen.
- `ACTIVITY_LINGER_MS = 5_000` (decided; spec §10 open question). Pulse lights on ANY op or status envelope or edit outcome; decays LINGER after the newest.
- Resting-state copy exactly: `Connected · agent active` subline with `· Xs ago` suffix once `agentActive` is false (X = whole seconds since lastActivityAt, ticking at 1 Hz; switch to `Xm ago` past 60s).
- The `thinking` axis (update_diagram render machine) stays untouched and takes precedence over the pulse on the badge/header.
- Branch: stack on `feat/agent-link-sliding-ttl` (new branch `feat/agent-link-pr2-activity-display` from it; PR bases on the PR1 branch until PR1 merges).
- Zero new tsc errors vs the PR1 branch baseline; commits one-line; no `git stash`.
- Deferred test debt from PR1's final review, paid here: assert the composable's status branch REPUBLISHES the handoff (spy on persistSession/localStorage write after a status event).

---

### Task 1: Composable — `lastActivityAt` fact + handoff mirror

**Files:** Modify `src/composables/agentLink/useAgentLinkSession.ts`, `src/composables/agentLink/sessionHandoff.ts`; test in `useAgentLinkSession.spec.ts` (+ `sessionHandoff.spec.ts` if it exists).

**Interfaces (produces):**
- `AgentLinkSessionApi.lastActivityAt: Ref<number | null>`
- `AgentLinkHandoffSession.lastActivityAt?: number` (persisted; adopted by `hydrateFrom`)
- `export const ACTIVITY_LINGER_MS = 5_000` (exported from the composable for components/tests)

**Steps (TDD):**
- [ ] Failing tests: (a) an op state-event sets `lastActivityAt` to the injected clock's now; (b) a status state-event sets it too; (c) a successful edit outcome sets it; (d) `hydrateFrom` adopts `session.lastActivityAt` onto a display-only instance; (e) startConnect resets it to null; (f) **deferred PR1 debt** — after a status event, the handoff record was re-persisted AND carries the new `expiresAt` + `lastActivityAt` (read the record back via the same seam existing handoff tests use).
- [ ] Implement: `const lastActivityAt = ref<number | null>(null)`; set in `handleRelayStateEvent` for `op` and `status` branches and in `recordEditOutcome`; include `...(lastActivityAt.value != null ? { lastActivityAt: lastActivityAt.value } : {})` in `handoffFeedFields()`; adopt in `hydrateFrom` (unconditional like `expiresAt`); reset in `startConnect`/`disconnect`; add to the returned API + `AgentLinkHandoffSession` type.
- [ ] `pnpm test:unit src/composables/agentLink` green; commit `feat(agent-link): track lastActivityAt in the session composable + handoff mirror`.

### Task 2: AgentStatusHeader + LiveBadge — pulse + resting state

**Files:** Modify `src/components/AgentLink/AgentStatusHeader.vue`, `src/components/AgentLink/LiveBadge.vue`; create `src/components/AgentLink/AgentStatusHeader.spec.ts` (mount tests, follow `SessionTtl.spec.ts` idioms incl. fake timers).

**Interfaces:** new optional prop `lastActivityAt?: number | null` on both; header computes `agentActive` with a self-contained 1-second ticker (copy `SessionTtl.vue`'s start/stopTicking pattern verbatim, incl. `onBeforeUnmount` teardown and `prefers-reduced-motion` respect for any pulse animation).

**Steps (TDD):**
- [ ] Failing mount tests: (a) `state='connected'`, fresh `lastActivityAt` → subline `Connected · agent active`; (b) advance fake timers 8s → subline gains `· 8s ago`; (c) 90s → `· 1m ago`; (d) `thinking=true` overrides the subline back to the existing thinking behavior; (e) no `lastActivityAt` → today's `Connected · reads & edits` fallback unchanged.
- [ ] Implement; LiveBadge gets a subtle pulse class while `agentActive` (CSS only, `@media (prefers-reduced-motion: reduce)` disables).
- [ ] Green; commit `feat(agent-link): resting-state pulse — Connected · agent active · Xs ago`.

### Task 3: Thread the prop (ConnectPanel → header; owner + Fullscreen)

**Files:** Modify `src/components/AgentLink/ConnectPanel.vue` (pass `:last-activity-at` into both `AgentStatusHeader` usages — connected + suspended templates), and the host that binds ConnectPanel's props from the composable (find it: grep `ConnectPanel` in `src/` — GenericViewer or a Fullscreen wrapper; bind `lastActivityAt` from the API the same way `expiresAt` is bound).

**Steps:**
- [ ] Trace both binding sites (`grep -rn "ConnectPanel\|expiresAt" src/components src/pages src/views` — mirror exactly how `expires-at` flows).
- [ ] Wire; run any ConnectPanel-adjacent specs + full `pnpm test:unit`; commit `feat(agent-link): thread lastActivityAt to the rail on both surfaces`.

### Task 4: Sweep + submit

- [ ] Full `pnpm test:unit`; `npx tsc --noEmit` line-count vs the PR1 branch (zero new).
- [ ] Push `feat/agent-link-pr2-activity-display`; draft PR **based on `feat/agent-link-sliding-ttl`** titled `feat(agent-link): activity pulse + resting state (PR2 display layer)`; babysit CI.

## Self-review
- Spec §5 coverage: pulse (pure function ✅ T1+T2), resting state ✅ T2, both-surfaces parity ✅ T1 handoff + T3, guardrail feed row already landed in PR1. Render machine untouched ✅ constraint.
- PR1 deferred debt (handoff republish assertion) ✅ T1(f).
- No placeholders; exact copy strings and constants stated; component test idioms named (SessionTtl.spec).
