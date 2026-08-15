# Agent Link Connection Experience (Phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the broken credential handoff in the Connect panel and surface staged connection progress (agent seen → tools loaded → verified → working) in the macro UI within seconds of the user pasting the setup command.

**Architecture:** The relay already authenticates every MCP request against the `AgentLinkSession` Durable Object via `GET /session` (`authenticateViaDo`, `mcp.ts`). We derive a *presence stage* from the JSON-RPC method, ride it on that same GET as query params (zero extra hops), persist the highest stage on the session record, and push it to the macro over the existing `{kind:'status'}` envelope's `activity` field (all plumbing exists end to end). The frontend adds display-only refs — **no new FSM states**; `waiting → connected` still flips on the first forwarded op. Separately, the Connect panel's `claude mcp add` command gains the missing `--header` credential and an appended one-shot trigger so a real client handshakes immediately.

**Tech Stack:** Cloudflare Pages Functions + Durable Objects (backend, vitest specs), Vue 3 + TypeScript (frontend, vitest specs), Playwright (e2e on lite-stg).

**Spec:** Conversation-derived; design ground truth = the workflow synthesis §5 ("连接进度快速反馈设计") delivered 2026-08-15 in session `c53df6ed`, itself argued from `docs/superpowers/specs/2026-07-13-agent-link-sliding-ttl-and-activity-design.md` (status bus, bump rules).

## Global Constraints

- **Presence must NEVER slide the TTL**: no write to `lastActivityMs`, no alarm re-arm, no `bumpActivity()` call from a presence-only request. The 2026-07-13 spec's bump definition (`tools/call` except `get_status`, plus `resources/read`) stays byte-identical.
- **Wire format**: extend the existing `{kind:'status'}` envelope via its `activity` field only. Never add a new envelope `kind` (an old macro drops unknown kinds; unknown `activity.type` values are ignored safely).
- **No new FSM states** in `agentLinkState.ts` / `useAgentLinkSession.ts` `TRANSITIONS` / `hydrateFrom()`. Presence is display-only reactive state.
- **Analytics first**: new event `agent_link_stage_reached` registered in `src/utils/analytics/catalog.ts` before any code fires it (project rule: events are part of DoD).
- **Deploys**: staging deploys go through CI on merge only (no local `forge deploy`, no direct wrangler deploys — user policy). The DO change ships via `agent-link-worker-deploy.yml`, the Pages/frontend change via `build-test-deploy.yml`; the `activity`-field format is order-tolerant in both directions.
- **`forge tunnel` cannot exercise the relay WSS** (CSP). Full-loop verification happens only on deployed lite-stg (`agent-link-enabled` flag: staging ✓ as of 2026-08-15).
- Commit style: one-line subject, no prose body; every commit compiles and passes `pnpm test:unit` for the touched workspace.

## Out of scope (separate plans)

Production `AGENT_LINK` binding enablement + companion-worker prod deploy (user-gated); deletion of the unused `peer=agent` WS path; deletion of the in-process `sessionRegistry` fallback; content-lock extraction; per-op forward timeouts; OAuth / `connect(code)`.

---

### Task 1: Env-derived MCP URL + credentialed, self-triggering setup command

**Files:**
- Modify: `src/composables/agentLink/relayUrl.ts` (add one export)
- Modify: `src/components/AgentLink/ConnectPanel.vue` (replace `MCP_ADD_COMMAND` const with computed; update `SetupInstructions`; update prompt copy)
- Test: `src/composables/agentLink/relayUrl.spec.ts`, `src/components/AgentLink/ConnectPanel.spec.ts`

**Interfaces:**
- Consumes: `forgeGlobal.zenumlRemoteBaseUrl` (existing default used by `mintAgentLinkSession`).
- Produces: `agentLinkMcpUrl(backendBaseUrl?: string): string` in `relayUrl.ts`; `ConnectPanel` renders the command from it + the live `token` prop.

**Background for the implementer:** today `ConnectPanel.vue` hardcodes `const MCP_ADD_COMMAND = 'claude mcp add --transport http conf-agent https://zenapi.zenuml.com/agent-link/mcp'`. Two defects: (a) no `--header "Authorization: Bearer <token>"` — the server (`mcp.ts` `extractToken`) accepts ONLY the Authorization header or `?token=`, so the shipped command cannot authenticate; (b) the URL is hardcoded prod, so staging macros print a command pointing at prod. Tokens rotate per session, so the command must be rebuilt per session from the `token` prop and the copy must stop saying "once".

- [ ] **Step 1: Write the failing tests**

```ts
// relayUrl.spec.ts (append)
import { agentLinkMcpUrl } from './relayUrl'

describe('agentLinkMcpUrl', () => {
  it('derives the MCP endpoint from the backend base URL', () => {
    expect(agentLinkMcpUrl('https://conf-stg-lite.zenuml.com')).toBe(
      'https://conf-stg-lite.zenuml.com/agent-link/mcp'
    )
  })
  it('defaults to forgeGlobal.zenumlRemoteBaseUrl', () => {
    // The existing spec file already mocks forgeGlobal; reuse that mock's base.
    expect(agentLinkMcpUrl()).toMatch(/\/agent-link\/mcp$/)
  })
})
```

```ts
// ConnectPanel.spec.ts (append; follow the file's existing mount helper)
it('setup command carries the session token as an Authorization header and a get_status trigger', () => {
  const wrapper = mountPanel({ state: 'waiting', token: 'CL-TEST-1234' })
  const cmd = wrapper.find('[data-testid="agent-link-setup-command"]').text()
  expect(cmd).toContain('--header "Authorization: Bearer CL-TEST-1234"')
  expect(cmd).toContain('/agent-link/mcp')
  expect(cmd).not.toContain('zenapi.zenuml.com') // env-derived in tests, not hardcoded prod
  expect(cmd).toContain('claude -p') // one-shot trigger provokes the handshake immediately
  expect(cmd).toContain('get_status')
})
```

- [ ] **Step 2: Run to verify failure** — `pnpm vitest run src/composables/agentLink/relayUrl.spec.ts src/components/AgentLink/ConnectPanel.spec.ts` → FAIL (`agentLinkMcpUrl` not exported; command lacks header).

- [ ] **Step 3: Implement**

```ts
// relayUrl.ts (append near mintAgentLinkSession)
// Hosted-MCP endpoint for the agent CLI. Derived from the same backend base
// the macro itself talks to, so a staging macro prints a staging command
// (the old hardcoded prod URL made staging untestable via the real UI path).
export function agentLinkMcpUrl(backendBaseUrl: string = forgeGlobal.zenumlRemoteBaseUrl): string {
  return `${backendBaseUrl}/agent-link/mcp`
}
```

```ts
// ConnectPanel.vue <script setup>: delete const MCP_ADD_COMMAND; add
import { agentLinkMcpUrl } from '@/composables/agentLink/relayUrl'

// Rebuilt per session: the token rotates on every mint, and mcp.ts accepts
// credentials ONLY as an Authorization header (or ?token=) — a command
// without --header cannot authenticate. The trailing `claude -p` one-shot
// makes a real MCP client connect NOW (mcp add alone only writes config;
// the handshake would otherwise wait for the user's next session start).
const mcpAddCommand = computed(() => {
  const token = props.token ?? ''
  return [
    `claude mcp add --transport http conf-agent ${agentLinkMcpUrl()} \\`,
    `  --header "Authorization: Bearer ${token}" \\`,
    `&& claude -p "Using conf-agent, call get_status and report the diagram title."`,
  ].join('\n')
})
```

`SetupInstructions` is a `defineComponent` closure with no props access — convert it to render from `mcpAddCommand` (move it into the same `<script setup>` scope; it already renders a single `<pre class="agent-link-panel__command" data-testid="agent-link-setup-command">`). Replace the "set up the connector (once)" copy with "Connect your agent (each session uses a fresh command)".

- [ ] **Step 4: Run tests** → PASS. Also `pnpm vitest run src/components/AgentLink` for regressions.
- [ ] **Step 5: Commit** — `git commit -m "fix(agent-link): setup command carries Bearer header, env URL, and an immediate handshake trigger"`

---

### Task 2: `mcp.ts` derives a presence stage and rides it on the auth GET

**Files:**
- Modify: `functions/agent-link/mcp.ts` (`authenticateViaDo` signature + call site)
- Test: `functions/agent-link/mcp.spec.ts`

**Interfaces:**
- Consumes: existing `authenticateViaDo(agentLink, token, bump)` → `stub.fetch('https://agent-link-do/session' + (bump ? '?bump=1' : ''))`.
- Produces: the GET gains `&presence=<stage>` and (initialize only) `&client=<name>`; stages are exactly `'initialized' | 'discovered' | 'verified' | 'working'`. Task 3's DO endpoint reads these params.

- [ ] **Step 1: Failing test**

```ts
// mcp.spec.ts (append; the file already builds a fake env.AGENT_LINK whose
// stub records fetched URLs — reuse that harness)
it.each([
  ['initialize', 'initialized'],
  ['notifications/initialized', 'initialized'],
  ['tools/list', 'discovered'],
  ['resources/list', 'discovered'],
])('method %s reports presence=%s on the DO auth GET', async (method, stage) => {
  await postMcp({ jsonrpc: '2.0', id: 1, method }, { token: 'CL-X' })
  expect(lastDoUrl()).toContain(`presence=${stage}`)
})

it('tools/call get_status reports presence=verified without bump', async () => {
  await postMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_status' } }, { token: 'CL-X' })
  expect(lastDoUrl()).toContain('presence=verified')
  expect(lastDoUrl()).not.toContain('bump=1')
})

it('bump-worthy tools/call reports presence=working AND bump=1', async () => {
  await postMcp({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'read_page' } }, { token: 'CL-X' })
  expect(lastDoUrl()).toContain('presence=working')
  expect(lastDoUrl()).toContain('bump=1')
})

it('initialize forwards the client name', async () => {
  await postMcp(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code', version: '2.0' } } },
    { token: 'CL-X' }
  )
  expect(lastDoUrl()).toContain('client=claude-code')
})
```

- [ ] **Step 2: Run** `pnpm vitest run functions/agent-link/mcp.spec.ts` → FAIL.
- [ ] **Step 3: Implement**

```ts
// mcp.ts — above authenticateViaDo
type PresenceStage = 'initialized' | 'discovered' | 'verified' | 'working'

// Presence = "how far has a real client got", derived per request from the
// method. Deliberately independent of bump-worthiness: presence NEVER slides
// the TTL (Task 3 enforces it DO-side); bump stays the 2026-07-13 definition.
function derivePresence(body: JsonRpcRequestBody, bumpWorthy: boolean): PresenceStage {
  if (bumpWorthy) return 'working'
  const m = body.method
  if (m === 'initialize' || m.startsWith('notifications/')) return 'initialized'
  if (m === 'tools/call') return 'verified' // only get_status reaches here non-bump
  return 'discovered' // tools/list, resources/list
}

function deriveClientName(body: JsonRpcRequestBody): string | undefined {
  const info = (body.params as { clientInfo?: { name?: unknown } } | undefined)?.clientInfo
  return typeof info?.name === 'string' ? info.name.slice(0, 64) : undefined
}
```

`authenticateViaDo` gains `presence: PresenceStage` and `clientName?: string` params; build the URL with `URLSearchParams` (`bump=1` iff bump, always `presence`, `client` iff defined). At the call site (the single `authenticateViaDo(env.AGENT_LINK, token, bumpWorthy)` call): `authenticateViaDo(env.AGENT_LINK, token, bumpWorthy, derivePresence(body, bumpWorthy), deriveClientName(body))`. The local-dev fallback branch (`authenticateSession`) is untouched.

- [ ] **Step 4: Run tests** → PASS (plus the file's existing suite).
- [ ] **Step 5: Commit** — `git commit -m "feat(agent-link): mcp relay derives presence stage per request and reports it on the auth round-trip"`

---

### Task 3: DO persists the highest presence stage and pushes it — without touching the TTL

**Files:**
- Modify: `functions/agent-link/AgentLinkSession.ts` (`fetch` /session branch, `handleSessionInfo`)
- Modify: `functions/agent-link/sessionToken.ts` (SessionRecord gains two optional fields)
- Modify: `functions/agent-link/forwarding.ts` (`StatusActivity` union gains the presence variant)
- Test: `functions/agent-link/AgentLinkSession.spec.ts`

**Interfaces:**
- Consumes: `GET /session?presence=<stage>&client=<name>` from Task 2; existing `pushStatus(activity?: StatusActivity)` / `statusEnvelope(expiresAt, hitCap, activity?)`.
- Produces: macro-bound `{kind:'status', expiresAt, hitCap, activity: { type: 'agent_presence', stage, clientName? }}`; `SessionRecord.presenceStage?: PresenceStage`, `SessionRecord.clientName?: string` persisted in DO storage. Task 5 consumes the envelope shape verbatim.

- [ ] **Step 1: Failing tests** (the spec file already has a harness that boots the DO with a fake storage + a recording macro socket — reuse it)

```ts
it('first initialized presence pushes an agent_presence status to the macro socket', async () => {
  await bootstrapSessionWithMacroSocket()
  await doFetch('/session?presence=initialized&client=claude-code')
  const pushed = lastMacroMessage()
  expect(pushed.kind).toBe('status')
  expect(pushed.activity).toEqual({ type: 'agent_presence', stage: 'initialized', clientName: 'claude-code' })
})

it('presence never slides the TTL', async () => {
  await bootstrapSessionWithMacroSocket()
  const before = await storedSession()
  await doFetch('/session?presence=initialized')
  const after = await storedSession()
  expect(after.lastActivityMs).toBe(before.lastActivityMs)   // untouched
  const pushed = lastMacroMessage()
  expect(pushed.expiresAt).toBe(effectiveExpiryMs(before.issuedAtMs, before.lastActivityMs)) // unchanged deadline
})

it('presence only advances and repeats are silent', async () => {
  await bootstrapSessionWithMacroSocket()
  await doFetch('/session?presence=discovered')
  const count = macroMessageCount()
  await doFetch('/session?presence=discovered') // repeat — no push
  await doFetch('/session?presence=initialized') // regression — no push
  expect(macroMessageCount()).toBe(count)
  await doFetch('/session?presence=verified') // advance — pushes
  expect(macroMessageCount()).toBe(count + 1)
})

it('presence stage survives hibernation (storage round-trip)', async () => {
  await bootstrapSessionWithMacroSocket()
  await doFetch('/session?presence=discovered')
  await simulateHibernationWake() // harness: new DO instance, same storage
  await doFetch('/session?presence=discovered') // same rank after wake — still silent
  expect(macroMessageCount()).toBe(1)
})
```

- [ ] **Step 2: Run** `pnpm vitest run functions/agent-link/AgentLinkSession.spec.ts` → FAIL.
- [ ] **Step 3: Implement**

```ts
// forwarding.ts — StatusActivity union gains:
export interface AgentPresenceActivity {
  type: 'agent_presence';
  stage: 'initialized' | 'discovered' | 'verified' | 'working';
  clientName?: string;
}
// StatusActivity = existing variants | AgentPresenceActivity

// sessionToken.ts — SessionRecord gains (both optional: records persisted
// before this change rehydrate fine):
//   presenceStage?: 'initialized' | 'discovered' | 'verified' | 'working';
//   clientName?: string;

// AgentLinkSession.ts
const PRESENCE_RANK = { initialized: 1, discovered: 2, verified: 3, working: 4 } as const;
type PresenceStage = keyof typeof PRESENCE_RANK;

// fetch(): the /session branch passes the new params through:
//   return this.handleSessionInfo(url.searchParams.get('bump') === '1',
//     url.searchParams.get('presence') as PresenceStage | null,
//     url.searchParams.get('client'));

private async handleSessionInfo(bump: boolean, presence: PresenceStage | null, client: string | null): Promise<Response> {
  // ...existing ensureSession/validate/bump block unchanged, then BEFORE the jsonResponse:
  if (presence && this.session && PRESENCE_RANK[presence] !== undefined) {
    const prev = this.session.presenceStage;
    if (!prev || PRESENCE_RANK[presence] > PRESENCE_RANK[prev]) {
      this.session.presenceStage = presence;
      if (client && !this.session.clientName) this.session.clientName = client;
      // Persist WITHOUT touching lastActivityMs and WITHOUT re-arming the
      // alarm — presence is not activity (global constraint #1).
      await this.state.storage.put('session', this.session);
      this.pushStatus({ type: 'agent_presence', stage: presence, clientName: this.session.clientName });
    }
  }
  // ...existing jsonResponse unchanged
}
```

- [ ] **Step 4: Run tests** → PASS, plus the file's full suite (hibernation, TTL, lock tests must stay green).
- [ ] **Step 5: Commit** — `git commit -m "feat(agent-link): DO records monotonic agent presence and pushes it on the status bus without sliding the TTL"`

---

### Task 4: Analytics registration

**Files:**
- Modify: `src/utils/analytics/catalog.ts` (add `"agent_link_stage_reached"` to the `AnalyticsEventName` union, next to the other `agent_link_*` names at lines ~452-459)
- Modify: `src/utils/analytics/types.ts` (properties: `stage: string; ms_since_connect_clicked: number; client_name?: string` on the agent-link property family)
- Test: `src/utils/analytics/trackAnalyticsEvent.spec.ts` compiles (type-level; follow how `agent_link_session_extended` is exercised there)

- [ ] **Step 1: Add the name + properties; run `pnpm vitest run src/utils/analytics` → PASS.**
- [ ] **Step 2: Commit** — `git commit -m "feat(analytics): register agent_link_stage_reached ahead of the presence UI"`

---

### Task 5: Frontend consumes presence — display-only refs, handoff mirror, analytics

**Files:**
- Modify: `src/composables/agentLink/useAgentLinkSession.ts` (status-event handler at ~line 352; new refs; return them)
- Modify: `src/composables/agentLink/relayClient.ts` (type only: the `activity` field's type union mirrors `AgentPresenceActivity` — the passthrough code at line ~300 already forwards it untouched)
- Modify: `src/composables/agentLink/sessionHandoff.ts` (handoff record gains optional `progressStage`, `agentClientName`; hydrate them)
- Test: `src/composables/agentLink/useAgentLinkSession.spec.ts`

**Interfaces:**
- Consumes: `{type:'status', activity:{type:'agent_presence', stage, clientName?}}` state events (Task 3 shape).
- Produces: `progressStage: Ref<'initialized'|'discovered'|'verified'|'working'|null>`, `agentClientName: Ref<string|null>` returned from `useAgentLinkSession`; both mirrored into the handoff record so Fullscreen shows the same stage. `agentLinkState` FSM untouched.

- [ ] **Step 1: Failing tests**

```ts
it('agent_presence status sets progressStage and clientName without changing the FSM state', () => {
  const s = setupWaitingSession()
  emitStateEvent(s, { type: 'status', activity: { type: 'agent_presence', stage: 'initialized', clientName: 'claude-code' } })
  expect(s.progressStage.value).toBe('initialized')
  expect(s.agentClientName.value).toBe('claude-code')
  expect(s.state.value).toBe('waiting') // FSM untouched — connected still needs the first op
})

it('agent_presence fires agent_link_stage_reached once per stage', () => {
  const s = setupWaitingSession()
  emitStateEvent(s, { type: 'status', activity: { type: 'agent_presence', stage: 'initialized' } })
  emitStateEvent(s, { type: 'status', activity: { type: 'agent_presence', stage: 'initialized' } })
  expect(trackedEvents('agent_link_stage_reached')).toHaveLength(1)
  expect(trackedEvents('agent_link_stage_reached')[0].properties.stage).toBe('initialized')
})

it('presence must not slide the local expiry mirror', () => {
  const s = setupWaitingSession()
  const before = s.expiresAt.value
  emitStateEvent(s, { type: 'status', expiresAt: before, activity: { type: 'agent_presence', stage: 'initialized' } })
  expect(s.expiresAt.value).toBe(before)
})
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** — inside the existing `if (event.type === 'status')` block, after the `guardrail_rejected` branch:

```ts
if (event.activity?.type === 'agent_presence') {
  const stage = event.activity.stage
  if (stage !== progressStage.value) {
    progressStage.value = stage
    if (event.activity.clientName) agentClientName.value = event.activity.clientName
    trackAnalyticsEvent('agent_link_stage_reached', {
      feature_area: 'agent_link',
      surface: 'fullscreen',
      macro_type: macroType,
      stage,
      ms_since_connect_clicked: connectClickedAt ? now() - connectClickedAt : -1,
      client_name: agentClientName.value ?? undefined,
    })
  }
}
```

(`connectClickedAt` — capture `now()` in the existing `startConnect()`; module-level `let` beside `lastExtendedFiredAt`.) Add both refs to the composable's return object; mirror into the handoff record where `state`/`dsl` are published (`publishThinking` path) and hydrate in `sessionHandoff.ts` alongside the existing optional fields.

- [ ] **Step 4: Run the composable's full suite** → PASS. **Step 5: Commit** — `git commit -m "feat(agent-link): surface presence stage + client name as display-only session state"`

---

### Task 6: ConnectPanel staged waiting UI + honest failure copy

**Files:**
- Modify: `src/components/AgentLink/ConnectPanel.vue` (waiting template ~lines 4-25; props; timeout state)
- Modify: `src/components/Viewer/GenericViewer.vue` (pass `progress-stage` + `client-name` props where ConnectPanel mounts, ~line 175 region / the fullscreen panel mount)
- Test: `src/components/AgentLink/ConnectPanel.spec.ts`

**Interfaces:**
- Consumes: `progressStage`, `agentClientName` from Task 5 (as optional props `progressStage?: string|null`, `clientName?: string`).
- Produces: waiting-state ladder UI; setup instructions hidden once `progressStage != null`.

- [ ] **Step 1: Failing tests**

```ts
it('waiting state shows the stage ladder once the agent is seen', () => {
  const w = mountPanel({ state: 'waiting', token: 'CL-T', progressStage: 'initialized', clientName: 'claude-code' })
  const ladder = w.find('[data-testid="agent-link-progress"]')
  expect(ladder.text()).toContain('claude-code 已连接')
  expect(w.find('[data-testid="agent-link-setup"]').exists()).toBe(false) // setup hidden after handshake
})

it('waiting state with no presence keeps today\'s pulse + collapsed setup', () => {
  const w = mountPanel({ state: 'waiting', token: 'CL-T', progressStage: null })
  expect(w.find('[data-testid="agent-link-waiting-status"]').text()).toContain('Waiting for your agent')
  expect(w.find('[data-testid="agent-link-setup"]').exists()).toBe(true)
})

it('timeout copy names a wrong/stale paste as a possible cause', () => {
  const w = mountPanel({ state: 'timeout', token: 'CL-T', progressStage: null })
  expect(w.text()).toContain('/mcp') // "restart the session or run /mcp" hint
})
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** — waiting branch renders: `progressStage == null` → existing pulse line + collapsed `<details>` setup; `progressStage != null` → `<ol data-testid="agent-link-progress">` with four rows (initialized: "✓ {clientName ?? 'Agent'} 已连接", discovered: "✓ 图表工具已加载", verified: "✓ 链路已验证", working handled by the FSM flip), rows at rank > current stage rendered dimmed; setup block `v-if="progressStage === null"`. Timeout state appends: "如果命令粘贴进了一个已在运行的会话，请重启它或执行 /mcp；token 粘贴错误服务端无法检测。" Stage copy uses the server-truth wording — never "connected to your session" for a `claude -p` one-shot (it proves the relay + token, not the interactive session; the `verified` row says "链路已验证" exactly for this reason).

- [ ] **Step 4: Run component suite** → PASS. **Step 5: Commit** — `git commit -m "feat(agent-link): staged connection ladder in the waiting panel, setup hidden once the agent is seen"`

---

### Task 7: Consume the two dead reconnect events

**Files:**
- Modify: `src/composables/agentLink/useAgentLinkSession.ts` (state-event handler: `reconnect_failed`, `error`)
- Modify: `src/components/AgentLink/SessionNotice.vue` only if the suspended notice lacks a "connection lost" variant (follow its existing variant pattern)
- Test: `src/composables/agentLink/useAgentLinkSession.spec.ts`

**Background:** `relayClient.ts:326` emits `{type:'reconnect_failed'}` after 5 backoff attempts (~15.5s) and `{type:'error'}` on socket errors; neither has a consumer, so the UI shows "reconnecting…" forever after the client has given up.

- [ ] **Step 1: Failing test**

```ts
it('reconnect_failed moves the session to suspended with a connection_lost notice', () => {
  const s = setupConnectedSession()
  emitStateEvent(s, { type: 'reconnect_failed' })
  expect(s.state.value).toBe('suspended')
  expect(s.noticeReason.value).toBe('connection_lost')
})
```

- [ ] **Step 2-4:** Implement by routing `reconnect_failed` through the same transition the clean `close` path uses to reach `suspended` (reuse the existing transition — do NOT add a new FSM state; `connection_lost` is a notice reason, not a state), surface `error.message` on the existing error-flash ref but with a persistent notice instead of the 4s flash when the socket is already down. Run suite → PASS.
- [ ] **Step 5: Commit** — `git commit -m "fix(agent-link): reconnect exhaustion and socket errors now surface instead of an eternal reconnecting label"`

---

### Task 8: e2e — presence lights the panel before the first op (lite-stg)

**Files:**
- Modify: `tests/e2e-tests/tests/agent-link/agent-link-e2e.spec.ts` (extend test 1 between mint and `read_page`)
- Modify: `tests/e2e-tests/helpers/agentLink.ts` (add `readProgressStage(page)` reading `[data-testid="agent-link-progress"]`)

**Precondition:** the merged changes are live on lite-stg via CI staging deploy — BOTH pipelines (`build-test-deploy.yml` for Pages/frontend, `agent-link-worker-deploy.yml` for the DO).

- [ ] **Step 1:** In the e2e, after `readSessionToken` and before `read_page`, POST `initialize` with the Bearer token (plain fetch is fine here — presence rides the auth GET, which fires for any authenticated method), then poll `readProgressStage(page)` for "已连接" within 5s:

```ts
const init = await fetch(agentLinkMcpUrl(), {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
  body: JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { clientInfo: { name: 'e2e-probe', version: '0' }, protocolVersion: '2024-11-05', capabilities: {} } }),
});
expect(init.status, 'initialize HTTP').toBe(200);
await expect.poll(() => readProgressStage(page), { timeout: 5000, message: 'presence reaches the panel before any op' }).toContain('已连接');
expect(await readPanelClass(page), 'FSM still waiting — presence is display-only').toBe('agent-link-panel--waiting');
```

- [ ] **Step 2:** Run `APP=zenuml-lite@stg npx playwright test tests/agent-link/agent-link-e2e.spec.ts --project=agent-link --workers=1` → 3 passed.
- [ ] **Step 3: Commit** — `git commit -m "test(agent-link): e2e asserts presence lights the panel before the first tool call"`

---

### Task 9 (user-gated): ship + verify

- [ ] Branch off `main` (worktree if the tree is dirty), PR via `submit-branch`, merge via `land-pr` → CI staging deploy (both pipelines).
- [ ] Spot check on lite-stg through the REAL UI path: mint in the rail → copy the panel's own command verbatim → run it in a terminal → panel shows "已连接" while still in the terminal → then a real `claude -p` op flips connected. This validates Task 1's fix end to end — the first time the shipped command will have ever worked as printed.
- [ ] Confirm `agent_link_stage_reached` rows in Mixpanel (project 3373228; ingest can lag ~1h).
- [ ] Production release only after the separate prod-binding plan (out of scope here) confirms `wrangler-prod.toml`'s `AGENT_LINK` binding + companion-worker prod deploy; the `agent-link-enabled` prod flag stays Default:False until then.

## Self-Review

1. **Spec coverage**: synthesis §5.2 ladder (Tasks 2/3/5/6), §5.3 wire format via `activity` (Task 3), §5.4 change list incl. analytics (Task 4/5), §5.5(a) instructions line — folded into Task 1's trigger command; §5.5(b) trigger (Task 1), §5.6 failure branches (Tasks 6/7), §5.7 minimal slice ordering preserved. Credential blocker (§4.2 of the report) = Task 1. Gap: §5.5(a) `initialize.instructions` first-line nudge — add to Task 2 Step 3 if desired; deliberately omitted here because Task 1's trigger command covers the same window deterministically.
2. **Placeholders**: none — every step names files, code, and run commands. Harness helpers referenced in Task 3 tests (`bootstrapSessionWithMacroSocket` etc.) exist in `AgentLinkSession.spec.ts`'s current suite; the implementer maps to the file's actual helper names on first read.
3. **Type consistency**: `PresenceStage` union spelled identically in Tasks 2/3/5; envelope field is `activity.type === 'agent_presence'` in Tasks 3/5; refs named `progressStage`/`agentClientName` in Tasks 5/6/8.
