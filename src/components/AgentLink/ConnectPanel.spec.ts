import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ConnectPanel from './ConnectPanel.vue'
import AgentStatusHeader from './AgentStatusHeader.vue'
import connectPanelSource from './ConnectPanel.vue?raw'
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

  it('waiting: shows the paste-prompt block with the token', () => {
    const wrapper = mountPanel({ state: 'waiting', token: 'tok-123' })

    expect(wrapper.find('[data-testid="agent-link-waiting"]').exists()).toBe(true)
    const prompt = wrapper.find('[data-testid="agent-link-prompt"]').text()
    expect(prompt).toContain('Connect to my ZenUML diagram via the conf-agent MCP.')
    expect(prompt).toContain('session: tok-123')
    expect(prompt).toContain('reads this page · edits this diagram · 10 min idle / 60 min max')
    expect(wrapper.find('[data-testid="agent-link-waiting-status"]').text()).toContain(
      'Waiting for your agent to connect'
    )
    expect(wrapper.find('[data-testid="agent-link-setup-disclosure"]').exists()).toBe(true)
  })

  it('connected: shows the activity feed entries and a Disconnect button', () => {
    const activityFeed: AgentLinkActivityEntry[] = [
      { summary: 'added a step', at: 1000 },
      { summary: 'renamed participant', at: 2000 },
    ]
    const wrapper = mountPanel({ state: 'connected', token: 'tok-123', activityFeed })

    const entries = wrapper.findAll('[data-testid="agent-link-activity-entry"]')
    expect(entries).toHaveLength(2)
    expect(entries[0].text()).toContain('added a step')
    expect(entries[1].text()).toContain('renamed participant')
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-session-line"]').text()).toContain('tok-123')
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
    expect(entries[0].text()).toContain('Read')
    expect(entries[1].text()).toContain('Searched')
    expect(entries[2].text()).toContain('Listed diagrams')
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

  it('connected: renders the connected panel class and green connected treatment', () => {
    const wrapper = mountPanel({ state: 'connected', token: 'tok-123' })

    expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain(
      'agent-link-panel--connected'
    )
    expect(wrapper.find('[data-testid="agent-link-connected"]').exists()).toBe(true)
    expect(wrapper.find('.agent-link-panel__live-dot').exists()).toBe(true)
    expect(connectPanelSource).toContain('.agent-link-panel--connected')
    expect(connectPanelSource).toContain('border-color: var(--agent-link-green)')
  })

  it('timeout: shows the setup command', () => {
    const wrapper = mountPanel({ state: 'timeout', token: 'tok-123' })

    expect(wrapper.find('[data-testid="agent-link-timeout"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-setup-command"]').text()).toContain(
      'claude mcp add --transport http conf-agent https://zenapi.zenuml.com/agent-link/mcp'
    )
    // The dead "Add to Cursor" button (no click handler) and the dead
    // "Use the no-install bridge instead" link (href="#") were removed —
    // the working `claude mcp add` command is the single setup path.
    expect(wrapper.find('[data-testid="agent-link-add-cursor-btn"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-link-no-install-link"]').exists()).toBe(false)
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
      expect.stringContaining('session: tok-123')
    )
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

  // Track G — suspended: the relay socket dropped unexpectedly but is still
  // resumable within the token TTL. Copy verbatim from Track H's design
  // contract (h-design-bundle/ui_kits/agent-link/README.md).
  it('suspended: shows the reconnecting banner with Disconnect and Revoke & re-link', () => {
    const wrapper = mountPanel({ state: 'suspended', token: 'tok-123' })

    expect(wrapper.find('[data-testid="agent-link-suspended"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain(
      'agent-link-panel--suspended'
    )
    expect(wrapper.text()).toContain('Connection paused — reconnecting…')
    expect(wrapper.find('[data-testid="agent-link-suspended-status"]').text()).toContain(
      'Waiting for the macro to reconnect. The agent will retry its next request'
    )
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-revoke-btn"]').exists()).toBe(true)
  })

  it('suspended: Disconnect and Revoke & re-link emit their respective events', async () => {
    const wrapper = mountPanel({ state: 'suspended', token: 'tok-123' })

    await wrapper.find('[data-testid="agent-link-disconnect-btn"]').trigger('click')
    await wrapper.find('[data-testid="agent-link-revoke-btn"]').trigger('click')

    expect(wrapper.emitted('disconnect')).toHaveLength(1)
    expect(wrapper.emitted('revoke')).toHaveLength(1)
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

  it('active: composes the status header, bound-diagram line, TTL meter and rail actions', () => {
    const wrapper = mountRail({
      state: 'connected',
      diagramTitle: 'Checkout flow',
      expiresAt: Date.now() + (8 * 60 + 42) * 1000,
    })

    // status header (wraps LiveBadge) with the generic client fallback
    const header = wrapper.find('[data-testid="agent-link-status-header"]')
    expect(header.exists()).toBe(true)
    expect(header.find('[data-testid="agent-link-status-header-name"]').text()).toBe('Connected agent')
    expect(header.find('[data-testid="agent-link-live-badge"]').exists()).toBe(true)
    // bound-diagram line names the diagram, verbatim "Linked to"
    expect(wrapper.text()).toContain('Linked to')
    expect(wrapper.text()).toContain('Checkout flow')
    // TTL meter
    expect(wrapper.find('[data-testid="agent-link-ttl"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-ttl-value"]').text()).toBe('8:42')
    // rail actions (footer) — Disconnect + Revoke & re-link
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-revoke-btn"]').exists()).toBe(true)
    // no thinking banner while idle
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

  it('thinking (op in flight): shows the blue "Agent is editing…" banner and the Working badge', () => {
    const wrapper = mountRail({ state: 'connected', thinking: 'thinking', diagramTitle: 'Checkout flow' })

    const banner = wrapper.find('[data-testid="agent-link-thinking-banner"]')
    expect(banner.exists()).toBe(true)
    expect(banner.classes()).toContain('agent-link-banner--work')
    expect(banner.text()).toContain('Agent is editing…')
    expect(banner.text()).toContain('Applying changes to the diagram')
    // LiveBadge flips to the blue "Working" variant
    expect(wrapper.find('[data-testid="agent-link-live-badge-working"]').exists()).toBe(true)
  })

  it('thinking: appends the elapsed-seconds hint after a few seconds', async () => {
    const wrapper = mountRail({ state: 'connected', thinking: 'thinking' })
    // No elapsed marker ("· Ns") on first paint.
    expect(wrapper.find('[data-testid="agent-link-thinking-banner"]').text()).not.toContain('·')
    await vi.advanceTimersByTimeAsync(6000)
    expect(wrapper.find('[data-testid="agent-link-thinking-banner"]').text()).toContain('· 6s')
  })

  it('suspended: amber reconnecting banner with the resume countdown', () => {
    const wrapper = mountRail({
      state: 'suspended',
      diagramTitle: 'Checkout flow',
      expiresAt: Date.now() + (6 * 60 + 12) * 1000,
    })

    expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain('agent-link-panel--suspended')
    expect(wrapper.text()).toContain('Connection paused — reconnecting…')
    expect(wrapper.find('[data-testid="agent-link-suspended-status"]').text()).toContain(
      'Waiting for the macro to reconnect. The agent will retry its next request'
    )
    expect(wrapper.text()).toContain('Resumes if reconnected within 6:12')
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
