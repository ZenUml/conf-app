import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ConnectPanel from './ConnectPanel.vue'
import AgentStatusHeader from './AgentStatusHeader.vue'
import type { AgentLinkActivityEntry } from '@/composables/agentLink/useAgentLinkSession'
import { GUARDRAIL_REJECTED_FEED_SUMMARY } from '@/composables/agentLink/useAgentLinkSession'

function mountPanel(props: {
  state:
    | 'idle'
    | 'waiting'
    | 'connected'
    | 'timeout'
    | 'suspended'
    | 'closed'
    | 'already_linked'
    | 'failed'
    | 'expired'
  token?: string | null
  activityFeed?: AgentLinkActivityEntry[]
  lastActivityAt?: number | null
  thinking?: 'idle' | 'thinking' | 'error'
  progressStage?: 'initialized' | 'discovered' | 'verified' | 'working' | null
  clientName?: string
  noticeReason?: 'connection_lost' | null
  expiresAt?: number | null
  atCap?: boolean
}) {
  return mount(ConnectPanel, {
    props: {
      token: null,
      activityFeed: [],
      ...props,
    },
  })
}

describe('ConnectPanel', () => {
  beforeEach(() => {
    vi.useRealTimers()
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('waiting: shows a connect tool prompt with the one-time code', () => {
    const wrapper = mountPanel({ state: 'waiting', token: 'tok-123' })

    expect(wrapper.find('[data-testid="agent-link-waiting"]').exists()).toBe(true)
    const prompt = wrapper.find('[data-testid="agent-link-prompt"]').text()
    expect(prompt).toContain('Using conf-agent, call connect')
    expect(prompt).toContain('code: tok-123')
    expect(wrapper.find('[data-testid="agent-link-waiting-status"]').text()).toContain(
      'Waiting for your agent to connect'
    )
    expect(wrapper.find('[data-testid="agent-link-setup-disclosure"]').exists()).toBe(true)
  })

  it('waiting: the TTL countdown is live from mint (idle/max window starts at issuedAt, not at "connected")', () => {
    const wrapper = mountPanel({ state: 'waiting', token: 'tok-123', expiresAt: Date.now() + 9 * 60 * 1000 })
    const ttl = wrapper.find('[data-testid="agent-link-ttl"]')
    expect(ttl.exists()).toBe(true)
    expect(ttl.text()).toContain('Session expires in')
  })

  it('waiting: no expiresAt yet (mint still in flight) renders no TTL meter, not a fake one', () => {
    const wrapper = mountPanel({ state: 'waiting', token: 'tok-123' })
    expect(wrapper.find('[data-testid="agent-link-ttl"]').exists()).toBe(false)
  })

  it('connected: shows the activity feed entries and a Disconnect button', () => {
    const activityFeed: AgentLinkActivityEntry[] = [
      { summary: 'added a step', at: 1000 },
      { summary: 'renamed participant', at: 2000 },
    ]
    const wrapper = mountPanel({ state: 'connected', token: 'tok-123', activityFeed })

    const entries = wrapper.findAll('[data-testid="agent-link-activity-entry"]')
    expect(entries).toHaveLength(2)
    expect(entries[0].text()).toContain('renamed participant')
    expect(entries[1].text()).toContain('added a step')
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('tok-123')
  })

  it('connected: spins only the newest updating row while the agent is working', () => {
    const wrapper = mountPanel({
      state: 'connected',
      thinking: 'thinking',
      activityFeed: [
        { summary: 'Agent is updating the diagram…', at: 1000 },
        { summary: 'Agent is updating the diagram…', at: 2000 },
      ],
    })

    const entries = wrapper.findAll('[data-testid="agent-link-activity-entry"]')
    expect(entries[0].classes()).toContain('agent-link-panel__feed-row--inflight')
    expect(entries[0].find('.agent-link-panel__feed-spin').exists()).toBe(true)
    expect(entries[1].classes()).not.toContain('agent-link-panel__feed-row--inflight')
    expect(entries[1].find('.agent-link-panel__feed-spin').exists()).toBe(false)
  })

  it('connected: shows at most five newest user-facing timeline items', () => {
    const activityFeed: AgentLinkActivityEntry[] = [
      { summary: 'oldest', at: 1000 },
      { summary: 'second', at: 2000 },
      { summary: 'Connection paused', at: 2500 },
      { summary: 'third', at: 3000 },
      { summary: 'fourth', at: 4000 },
      { summary: 'Reconnected · resumed session', at: 4500 },
      { summary: 'fifth', at: 5000 },
      { summary: 'newest', at: 6000 },
    ]
    const wrapper = mountPanel({ state: 'connected', activityFeed })
    const entries = wrapper.findAll('[data-testid="agent-link-activity-entry"]')

    expect(entries).toHaveLength(5)
    expect(entries[0].text()).toContain('newest')
    expect(entries.at(-1)?.text()).toContain('second')
    expect(wrapper.text()).not.toContain('oldest')
    expect(wrapper.text()).not.toContain('Connection paused')
    expect(wrapper.text()).not.toContain('Reconnected')
  })

  it('connected: keeps settled updating rows static in the activity history', () => {
    const wrapper = mountPanel({
      state: 'connected',
      thinking: 'idle',
      activityFeed: [
        { summary: 'Agent is updating the diagram…', at: 1000 },
        { summary: 'diagram updated', at: 2000 },
      ],
    })

    const entries = wrapper.findAll('[data-testid="agent-link-activity-entry"]')
    expect(entries[0].classes()).not.toContain('agent-link-panel__feed-row--inflight')
    expect(entries[0].find('.agent-link-panel__feed-spin').exists()).toBe(false)
    expect(entries[0].find('.agent-link-panel__feed-ic--ok').exists()).toBe(true)
  })

  it('connected: classifies Track U discovery feed rows (read/search/list) as muted, distinct icons', () => {
    const activityFeed: AgentLinkActivityEntry[] = [
      { summary: 'Read “Checkout flow”', at: 1000 },
      { summary: 'Searched “payment retry” → 3 hits', at: 2000 },
      { summary: 'Listed diagrams in this space → 5', at: 3000 },
    ]
    const wrapper = mountPanel({ state: 'connected', token: 'tok-123', activityFeed })

    const entries = wrapper.findAll('[data-testid="agent-link-activity-entry"]')
    expect(entries).toHaveLength(3)
    entries.forEach((entry) => {
      expect(entry.find('.agent-link-panel__feed-ic--muted').exists()).toBe(true)
    })
    expect(entries[0].text()).toContain('Listed diagrams')
    expect(entries[1].text()).toContain('Searched')
    expect(entries[2].text()).toContain('Read')
    // Each discovery kind renders its own icon glyph, not the generic checkmark.
    const icons = entries.map((entry) => entry.find('.agent-link-panel__feed-ic').html())
    expect(new Set(icons).size).toBe(3)
  })

  it('connected: classifies the guardrail-rejected feed row as an error (err tone + error icon)', () => {
    // The relay-side guardrail reject (useAgentLinkSession's
    // GUARDRAIL_REJECTED_FEED_SUMMARY) must read as a failure in the feed, not
    // fall through to the generic ok/checkmark tone. Fed verbatim from the
    // exported constant so a future copy edit that drops the leading '⚠' (the
    // classifier's sole error signal) fails this test instead of silently
    // downgrading the row.
    const activityFeed: AgentLinkActivityEntry[] = [
      { summary: GUARDRAIL_REJECTED_FEED_SUMMARY, at: 1000 },
    ]
    const wrapper = mountPanel({ state: 'connected', token: 'tok-123', activityFeed })

    const entry = wrapper.find('[data-testid="agent-link-activity-entry"]')
    expect(entry.exists()).toBe(true)
    expect(entry.find('.agent-link-panel__feed-ic--err').exists()).toBe(true)
    // Not the generic success tone.
    expect(entry.find('.agent-link-panel__feed-ic--ok').exists()).toBe(false)
  })

  it('connected: uses the quiet header signal without a full-panel green border', () => {
    const wrapper = mountPanel({ state: 'connected', token: 'tok-123' })

    expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain(
      'agent-link-panel--connected'
    )
    expect(wrapper.find('[data-testid="agent-link-connected"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-live-badge"]').text()).toBe('Connected')
    expect(wrapper.attributes('style') ?? '').not.toContain('border-color')
  })

  it('waiting state shows the stage ladder once the agent is seen', () => {
    const w = mountPanel({ state: 'waiting', token: 'CL-T', progressStage: 'initialized', clientName: 'claude-code' })
    const ladder = w.find('[data-testid="agent-link-progress"]')
    expect(ladder.text()).toContain('claude-code connected')
    expect(ladder.text()).toContain('Diagram tools loaded')
    expect(ladder.text()).toContain('Link verified')
    expect(w.find('[data-testid="agent-link-setup"]').exists()).toBe(false) // setup hidden after handshake
  })

  it("waiting state with no presence keeps today's pulse + collapsed setup", () => {
    const w = mountPanel({ state: 'waiting', token: 'CL-T', progressStage: null })
    expect(w.find('[data-testid="agent-link-waiting-status"]').text()).toContain('Waiting for your agent')
    expect(w.find('[data-testid="agent-link-setup"]').exists()).toBe(true)
  })

  // Anchored on the hint ELEMENT and on wording unique to it. The earlier
  // version asserted only that the panel text contained '/mcp', which the
  // setup command's own URL (…/agent-link/mcp) already satisfies — deleting
  // the whole hint paragraph left that assertion green (final-review fix 4).
  it('timeout copy names a wrong/stale paste as a possible cause', () => {
    const w = mountPanel({ state: 'timeout', token: 'CL-T', progressStage: null })
    const hint = w.find('[data-testid="agent-link-timeout-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('already running')
    expect(hint.text()).toContain('run /mcp')
    expect(hint.text()).toContain('linking code expired')
  })

  it('timeout: offers a re-mint action, distinct from re-pasting the prompt or re-running setup', async () => {
    const wrapper = mountPanel({ state: 'timeout', token: 'tok-123' })
    const btn = wrapper.find('[data-testid="agent-link-timeout-remint-btn"]')
    expect(btn.exists()).toBe(true)
    await btn.trigger('click')
    expect(wrapper.emitted('reconnect')).toBeTruthy()
  })

  it('timeout: shows the setup command', () => {
    const wrapper = mountPanel({ state: 'timeout', token: 'tok-123' })

    expect(wrapper.find('[data-testid="agent-link-timeout"]').exists()).toBe(true)
    const cmd = wrapper.find('[data-testid="agent-link-setup-command"]').text()
    expect(cmd).toContain('claude mcp add --transport http conf-agent')
    expect(cmd).toContain('/agent-link/mcp')
    expect(cmd).not.toContain('Authorization')
    expect(cmd).not.toContain('tok-123')
    // The dead "Add to Cursor" button (no click handler) and the dead
    // "Use the no-install bridge instead" link (href="#") were removed —
    // the working `claude mcp add` command is the single setup path.
    expect(wrapper.find('[data-testid="agent-link-add-cursor-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-link-no-install-link"]').exists()).toBe(false)
  })

  it('setup command is stable and contains no session credential', () => {
    const wrapper = mountPanel({ state: 'waiting', token: 'CL-TEST-1234' })
    const cmd = wrapper.find('[data-testid="agent-link-setup-command"]').text()
    expect(cmd).not.toContain('Authorization')
    expect(cmd).not.toContain('CL-TEST-1234')
    expect(cmd).toContain('/agent-link/mcp')
    expect(cmd).not.toContain('zenapi.zenuml.com') // env-derived in tests, not hardcoded prod
    expect(cmd).not.toContain('claude -p')
  })

  it('does not expose the browser/Worker transport ladder in the user rail', () => {
    for (const state of ['waiting', 'connected', 'suspended', 'closed'] as const) {
      const wrapper = mountPanel({ state, token: 'CL-T' })
      expect(wrapper.find('[data-testid="agent-link-rail"]').exists()).toBe(false)
      expect(wrapper.text()).not.toContain('Worker')
    }
  })

  it('Copy prompt failure: shows "Copy failed — select the text above" on the button', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    const wrapper = mountPanel({ state: 'waiting', token: 'tok-123' })

    await wrapper.find('[data-testid="agent-link-copy-prompt-btn"]').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[data-testid="agent-link-copy-prompt-btn"]').text()).toBe(
      'Copy failed — select the text above'
    )
  })

  it('Copy prompt writes the prompt text to the clipboard', async () => {
    const wrapper = mountPanel({ state: 'waiting', token: 'tok-123' })

    await wrapper.find('[data-testid="agent-link-copy-prompt-btn"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('code: tok-123')
    )
    expect(wrapper.emitted('instruction-copied')).toEqual([['pairing_prompt']])
  })

  it('copies the stable setup command separately from the pairing code', async () => {
    const wrapper = mountPanel({ state: 'waiting', token: 'tok-123' })

    await wrapper.find('[data-testid="agent-link-copy-setup-btn"]').trigger('click')

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('claude mcp add --transport http conf-agent')
    )
    expect(navigator.clipboard.writeText).not.toHaveBeenCalledWith(expect.stringContaining('tok-123'))
    expect(wrapper.emitted('instruction-copied')).toEqual([['setup_command']])
  })

  it('Disconnect emits the disconnect event', async () => {
    const wrapper = mountPanel({ state: 'connected', token: 'tok-123' })

    await wrapper.find('[data-testid="agent-link-disconnect-btn"]').trigger('click')

    expect(wrapper.emitted('disconnect')).toHaveLength(1)
  })

  it('connected: Revoke & re-link emits the revoke event', async () => {
    const wrapper = mountPanel({ state: 'connected', token: 'tok-123' })

    await wrapper.find('[data-testid="agent-link-revoke-btn"]').trigger('click')

    expect(wrapper.emitted('revoke')).toHaveLength(1)
  })

  it('automatic recovery keeps the connected timeline body and changes only the header signal', () => {
    const props = {
      token: 'tok-123',
      clientName: 'claude-code',
      expiresAt: Date.now() + 60_000,
      activityFeed: [
        { summary: 'Read “Checkout flow”', at: 1000 },
        { summary: 'Connection paused', at: 2000 },
        { summary: 'Reconnected · resumed session', at: 3000 },
        { summary: 'diagram updated', at: 4000 },
      ],
    }
    const connected = mountPanel({ state: 'connected', ...props })
    const recovering = mountPanel({ state: 'suspended', ...props })

    expect(recovering.find('[data-testid="agent-link-automatic-recovery"]').exists()).toBe(true)
    expect(recovering.find('[data-testid="agent-link-suspended"]').exists()).toBe(false)
    expect(recovering.find('[data-testid="agent-link-live-badge-suspended"]').text()).toBe('Connecting')
    expect(recovering.find('[data-testid="agent-link-activity-feed"]').text()).toBe(
      connected.find('[data-testid="agent-link-activity-feed"]').text()
    )
    expect(recovering.find('[data-testid="agent-link-ttl"]').text()).toBe(
      connected.find('[data-testid="agent-link-ttl"]').text()
    )
    expect(recovering.text()).not.toContain('Connection paused')
    expect(recovering.text()).not.toContain('Reconnected')
    expect(recovering.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(true)
    expect(recovering.find('[data-testid="agent-link-revoke-btn"]').exists()).toBe(true)
  })

  it('suspended: Disconnect and Revoke & re-link emit their respective events', async () => {
    const wrapper = mountPanel({ state: 'suspended', token: 'tok-123' })

    await wrapper.find('[data-testid="agent-link-disconnect-btn"]').trigger('click')
    await wrapper.find('[data-testid="agent-link-revoke-btn"]').trigger('click')

    expect(wrapper.emitted('disconnect')).toHaveLength(1)
    expect(wrapper.emitted('revoke')).toHaveLength(1)
  })

  // Task 7: relayClient.ts's own reconnect backoff gave up — the composable
  // surfaces noticeReason:'connection_lost' instead of a new FSM state, and
  // the 'suspended' banner must stop implying an ongoing retry.
  it('suspended + connection_lost notice: shows "Connection lost" with a manual Reconnect action instead of the reconnecting spinner copy', async () => {
    const wrapper = mountPanel({ state: 'suspended', token: 'tok-123', noticeReason: 'connection_lost' })

    expect(wrapper.text()).toContain('Connection lost')
    expect(wrapper.text()).not.toContain('Connection paused — reconnecting…')
    expect(wrapper.find('[data-testid="agent-link-suspended-status"]').text()).toContain(
      'We could not reconnect automatically'
    )
    await wrapper.find('[data-testid="agent-link-suspended-reconnect-btn"]').trigger('click')
    expect(wrapper.emitted('revoke')).toHaveLength(1)
    // The icon must be static (jsdom can't evaluate CSS animations, but
    // .agent-link-banner__spin is the class that carries the infinite-spin
    // rule — asserting its absence is the right level of check). A spinning
    // icon on a "gave up retrying" notice would visually contradict the copy.
    expect(wrapper.find('[data-testid="agent-link-suspended"] svg').classes()).not.toContain(
      'agent-link-banner__spin'
    )
  })

  it('already_linked: renders the rejected notice with honest (no-fake-time) copy and actions', async () => {
    const wrapper = mountPanel({ state: 'already_linked' })

    const notice = wrapper.find('[data-testid="agent-link-notice"]')
    expect(notice.exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe(
      'This diagram is already linked to an agent'
    )
    expect(notice.text()).toContain(
      'Another agent session holds this diagram. Only one agent can hold the link at a time.'
    )
    expect(wrapper.find('[data-testid="agent-link-notice-revoke-btn"]').text()).toContain('Revoke & re-link')
    expect(wrapper.find('[data-testid="agent-link-notice-cancel-btn"]').text()).toContain('Cancel')

    await wrapper.find('[data-testid="agent-link-notice-revoke-btn"]').trigger('click')
    await wrapper.find('[data-testid="agent-link-notice-cancel-btn"]').trigger('click')
    expect(wrapper.emitted('revoke')).toHaveLength(1)
    expect(wrapper.emitted('cancel')).toHaveLength(1)
  })

  it('already_linked: forwards lockExpiresAt to SessionNotice for an honest countdown', () => {
    const lockExpiresAt = Date.now() + 5 * 60 * 1000
    const wrapper = mountPanel({ state: 'already_linked', lockExpiresAt } as any)

    const notice = wrapper.find('[data-testid="agent-link-notice"]')
    expect(notice.text()).toContain('expires in ~5 min')
  })

  it('failed: renders a visible retryable mint-failure notice', () => {
    const wrapper = mountPanel({ state: 'failed' })

    const notice = wrapper.find('[data-testid="agent-link-notice"]')
    expect(notice.exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe('Could not link your agent')
    expect(notice.text()).toContain('We could not create a link session. Try reconnecting in a moment')
    expect(wrapper.find('[data-testid="agent-link-reconnect-btn"]').exists()).toBe(true)
  })

  // #314: the client-side TTL watchdog moves a stale session to 'expired' —
  // the rail must show the (already-built) SessionNotice "expired" variant
  // and a working Reconnect CTA, not stay stuck on the connected/suspended
  // rendering with a dead "0:00" countdown.
  it('expired: renders the "Session expired" notice and Reconnect emits reconnect', async () => {
    const wrapper = mountPanel({ state: 'expired' })

    const notice = wrapper.find('[data-testid="agent-link-notice"]')
    expect(notice.exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe('Session expired')
    expect(notice.text()).toContain(
      'Your session ended. Your diagram is saved — nothing was lost. Reconnect to link a new agent session'
    )
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(false)

    await wrapper.find('[data-testid="agent-link-reconnect-btn"]').trigger('click')
    expect(wrapper.emitted('reconnect')).toHaveLength(1)
  })
})

// Track H — the 316px rail composition (design contract:
// h-design-bundle/ui_kits/agent-link/README.md). Verifies the four
// load-bearing states render the README's region→component + copy mapping.
describe('ConnectPanel — Track H rail composition', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'))
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function mountRail(props: Record<string, unknown>) {
    return mount(ConnectPanel, {
      props: { token: 'tok-1', activityFeed: [], ...props } as any,
    })
  }

  it('active: composes client identity, Connected signal, TTL, timeline and rail actions', () => {
    const wrapper = mountRail({
      state: 'connected',
      diagramTitle: 'Checkout flow',
      expiresAt: Date.now() + (8 * 60 + 42) * 1000,
    })

    // status header (wraps LiveBadge) with the generic client fallback
    const header = wrapper.find('[data-testid="agent-link-status-header"]')
    expect(header.exists()).toBe(true)
    expect(header.find('[data-testid="agent-link-status-header-name"]').text()).toBe('AI assistant')
    expect(header.find('[data-testid="agent-link-live-badge"]').exists()).toBe(true)
    expect(wrapper.text()).not.toContain('Linked to')
    expect(wrapper.text()).not.toContain('Checkout flow')
    // TTL meter
    expect(wrapper.find('[data-testid="agent-link-ttl"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-ttl-value"]').text()).toBe('8:42')
    // rail actions (footer) — Disconnect + Revoke & re-link
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-revoke-btn"]').exists()).toBe(true)
    // Editing never creates a separate banner.
    expect(wrapper.find('[data-testid="agent-link-thinking-banner"]').exists()).toBe(false)
  })

  it('active: honours an explicit client name in the status header', () => {
    const wrapper = mountRail({ state: 'connected', clientName: 'Claude Code' })
    expect(wrapper.find('[data-testid="agent-link-status-header-name"]').text()).toBe('Claude Code')
  })

  it('passes lastActivityAt through to the connected and suspended status headers', () => {
    const lastActivityAt = Date.now() - 1000

    const connected = mountRail({ state: 'connected', lastActivityAt })
    const suspended = mountRail({ state: 'suspended', lastActivityAt })

    expect(connected.findComponent(AgentStatusHeader).props('lastActivityAt')).toBe(lastActivityAt)
    expect(suspended.findComponent(AgentStatusHeader).props('lastActivityAt')).toBe(lastActivityAt)
  })

  it('thinking: makes current work the first timeline row without a banner or layout jump', () => {
    const wrapper = mountRail({
      state: 'connected',
      thinking: 'thinking',
      activityFeed: [
        { summary: 'Read “Checkout flow”', at: 1000 },
        { summary: 'Agent is updating the diagram…', at: 2000 },
      ],
    })

    const entries = wrapper.findAll('[data-testid="agent-link-activity-entry"]')
    expect(entries[0].text()).toContain('Agent is updating')
    expect(entries[0].classes()).toContain('agent-link-panel__feed-row--inflight')
    expect(wrapper.find('[data-testid="agent-link-thinking-banner"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-link-live-badge"]').text()).toBe('Connected')
  })

  it('suspended: renders only the amber Connecting header treatment during retries', () => {
    const wrapper = mountRail({
      state: 'suspended',
      diagramTitle: 'Checkout flow',
      expiresAt: Date.now() + (6 * 60 + 12) * 1000,
    })

    expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain('agent-link-panel--suspended')
    expect(wrapper.find('[data-testid="agent-link-live-badge-suspended"]').text()).toBe('Connecting')
    expect(wrapper.find('[data-testid="agent-link-automatic-recovery"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-suspended-status"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Connection paused')
    expect(wrapper.text()).not.toContain('Resumes if reconnected')
    // suspended keeps Disconnect + Revoke & re-link
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-revoke-btn"]').exists()).toBe(true)
  })

  it('closed (terminal): shows the disconnected notice and Reconnect, and emits reconnect', async () => {
    const wrapper = mountRail({ state: 'closed', diagramTitle: 'Checkout flow' })

    const notice = wrapper.find('[data-testid="agent-link-notice"]')
    expect(notice.exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe('Agent disconnected')
    expect(notice.text()).toContain(
      'Your session ended. Your diagram is saved — nothing was lost. Reconnect to link a new agent session'
    )
    // no footer actions in the terminal state — Reconnect is the only CTA
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(false)

    await wrapper.find('[data-testid="agent-link-reconnect-btn"]').trigger('click')
    expect(wrapper.emitted('reconnect')).toHaveLength(1)
  })

  it('already-linked rejection: shows the rejected notice and Revoke & re-link, not an empty rail', () => {
    const wrapper = mountRail({ state: 'already_linked', diagramTitle: 'Checkout flow' })

    expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain('agent-link-panel--already_linked')
    expect(wrapper.find('[data-testid="agent-link-notice"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe(
      'This diagram is already linked to an agent'
    )
    expect(wrapper.find('[data-testid="agent-link-notice-revoke-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-cancel-btn"]').exists()).toBe(true)
  })

  it('idle: renders an empty panel (no header, notice, feed or actions) — nothing before connect', () => {
    const wrapper = mountRail({ state: 'idle' })
    expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain('agent-link-panel--idle')
    expect(wrapper.find('[data-testid="agent-link-status-header"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-link-notice"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(false)
  })
})
