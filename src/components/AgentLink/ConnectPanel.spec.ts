import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ConnectPanel from './ConnectPanel.vue'
import AgentStatusHeader from './AgentStatusHeader.vue'
import connectPanelSource from './ConnectPanel.vue?raw'
import type { AgentLinkActivityEntry } from '@/composables/agentLink/useAgentLinkSession'
import { GUARDRAIL_REJECTED_FEED_SUMMARY } from '@/composables/agentLink/useAgentLinkSession'
import { rememberAgentLinkClient } from '@/composables/agentLink/clientMemory'
import {
  AGENT_LINK_PROTOCOL_HELP_PROMPT,
  AGENT_LINK_SETUP_HELP_PROMPT,
} from './helpPrompts'

function mountPanel(props: {
  state:
    | 'idle'
    | 'waiting'
    | 'connected'
    | 'timeout'
    | 'suspended'
    | 'recovery_exhausted'
    | 'incompatible'
    | 'closed'
    | 'already_linked'
    | 'failed'
    | 'expired'
  token?: string | null
  activityFeed?: AgentLinkActivityEntry[]
  lastActivityAt?: number | null
  thinking?: 'idle' | 'thinking' | 'error'
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
    window.localStorage.clear()
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    })
  })

  it('first-time pairing: shows one generic copyable pairing prompt', () => {
    const wrapper = mountPanel({ state: 'waiting', token: 'tok-123' })

    expect(wrapper.find('[data-testid="agent-link-pairing"]').exists()).toBe(true)
    const prompt = wrapper.find('[data-testid="agent-link-prompt"]').text()
    expect(wrapper.text()).toContain('Connect')
    expect(prompt).toContain('Connect this AI assistant to my ZenUML diagram through Agent Link.')
    expect(prompt).toContain('session: tok-123')
    expect(prompt).toContain('reads this page · edits this diagram · 10 min idle / 60 min max')
    const help = wrapper.find('[data-testid="agent-link-help-disclosure"]')
    expect(help.exists()).toBe(true)
    expect(help.attributes('open')).toBeUndefined()
    expect(help.find('summary').text()).toBe('Need help?')
    expect(wrapper.text()).not.toContain('Codex')
  })

  it('keeps a modest gap between copyable prompts and their adjacent copy action', () => {
    expect(connectPanelSource).toContain('.agent-link-panel__prompt + .agent-link-panel__btn')
    expect(connectPanelSource).toMatch(
      /\.agent-link-panel__prompt \+ \.agent-link-panel__btn\s*\{\s*margin-top: 8px;/
    )
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
    expect(entries[0].classes()).not.toContain('agent-link-panel__feed-row--inflight')
    expect(entries[0].find('.agent-link-panel__feed-spin').exists()).toBe(false)
    expect(entries[1].classes()).toContain('agent-link-panel__feed-row--inflight')
    expect(entries[1].find('.agent-link-panel__feed-spin').exists()).toBe(true)
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
    expect(connectPanelSource).toContain('.agent-link-panel--connected')
    expect(connectPanelSource).toContain('border-color: var(--agent-link-green)')
  })

  it('timeout keeps the same pairing handoff instead of showing an installation wall', () => {
    const wrapper = mountPanel({ state: 'timeout', token: 'tok-123' })

    expect(wrapper.find('[data-testid="agent-link-pairing"]').exists()).toBe(true)
    const help = wrapper.find('[data-testid="agent-link-help-disclosure"]')
    expect(help.exists()).toBe(true)
    expect(help.attributes('open')).toBeUndefined()
    expect(wrapper.text()).not.toContain('claude mcp add')
    expect(wrapper.text()).not.toContain('http')
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
    expect(wrapper.find('[data-testid="agent-link-waiting"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-client-carousel"]').exists()).toBe(true)
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.find('[data-testid="agent-link-help-disclosure"]').exists()).toBe(false)
  })

  it('shows remembered client only as a quiet cue in the ordinary pairing state', () => {
    rememberAgentLinkClient('Codex')
    const wrapper = mountPanel({ state: 'waiting', token: 'tok-123' })
    expect(wrapper.find('[data-testid="agent-link-last-agent"]').text()).toContain('Last connected with Codex')
    expect(wrapper.find('[data-testid="agent-link-last-agent"]').text()).not.toContain('another')
    expect(wrapper.text()).not.toContain('Codex is installed')
    expect(wrapper.text()).not.toContain('Codex is online')

    const closed = mountPanel({ state: 'closed' })
    expect(closed.find('[data-testid="agent-link-last-agent"]').exists()).toBe(false)
  })

  it.each([
    ['setup', 'waiting', 'agent-link-setup-help-btn', AGENT_LINK_SETUP_HELP_PROMPT],
    ['ended connection', 'recovery_exhausted', 'agent-link-setup-help-btn', AGENT_LINK_SETUP_HELP_PROMPT],
    ['expired connection', 'expired', 'agent-link-setup-help-btn', AGENT_LINK_SETUP_HELP_PROMPT],
    ['failed connection', 'failed', 'agent-link-setup-help-btn', AGENT_LINK_SETUP_HELP_PROMPT],
    ['protocol', 'incompatible', 'agent-link-protocol-help-btn', AGENT_LINK_PROTOCOL_HELP_PROMPT],
  ] as const)('%s help copies a safe state-aware prompt', async (_name, state, testId, expectedPrompt) => {
    const wrapper = mountPanel({ state, token: 'tok-secret' })
    await wrapper.find(`[data-testid="${testId}"]`).trigger('click')
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expectedPrompt)
    expect(expectedPrompt).not.toMatch(/https?:\/\/|session:|CL-[A-Z0-9]+|codex exec/i)
    expect(expectedPrompt).toContain('Agent Link MCP')
  })

  it('keeps optional help behind progressive disclosure and explains the paste destination', () => {
    const wrapper = mountPanel({ state: 'recovery_exhausted', token: 'tok-123' })
    const help = wrapper.find('[data-testid="agent-link-help-disclosure"]')
    expect(help.attributes('open')).toBeUndefined()
    expect(help.find('summary').text()).toBe('Need help?')
    expect(help.text()).toContain('This is optional')
    expect(help.text()).toContain('paste it into the AI assistant you are using')
    expect(help.find('[data-testid="agent-link-setup-help-btn"]').text()).toBe('Copy help message')
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

  it('suspended: reduces automatic recovery to the existing compact connection header', () => {
    const wrapper = mountPanel({ state: 'suspended', token: 'tok-123', lastActivityAt: 1000 })

    expect(wrapper.find('[data-testid="agent-link-automatic-recovery"]').exists()).toBe(true)
    expect(wrapper.findComponent(AgentStatusHeader).exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-live-badge-suspended"]').text()).toContain('Connecting')
    expect(wrapper.find('[data-testid="agent-link-live-badge-suspended"]').attributes('role')).toBe('status')
    expect(wrapper.find('p').exists()).toBe(false)
    expect(wrapper.text()).not.toMatch(/countdown|resume|reconnect/i)
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(wrapper.find('[data-testid="agent-link-help-disclosure"]').exists()).toBe(false)
  })

  it('recovery exhausted: returns to the ordinary connect task without transport jargon', () => {
    const wrapper = mountPanel({ state: 'recovery_exhausted', token: 'tok-123' })
    expect(wrapper.find('h3').text()).toBe('Connect')
    expect(wrapper.text()).toContain('This connection ended')
    expect(wrapper.text()).not.toMatch(/reconnect|resume/i)
    expect(wrapper.find('[data-testid="agent-link-copy-prompt-btn"]').text()).toBe('Copy prompt')
    expect(wrapper.find('[data-testid="agent-link-prompt"]').text()).toContain('session: tok-123')
    expect(wrapper.find('[data-testid="agent-link-help-disclosure"]').attributes('open')).toBeUndefined()
  })

  it('protocol incompatibility offers a recovery prompt, not repeated retries', () => {
    const wrapper = mountPanel({ state: 'incompatible', token: 'tok-123' })
    expect(wrapper.text()).toContain('Your MCP needs an update')
    expect(wrapper.text()).toContain('Update Agent Link MCP, then start a fresh AI assistant session')
    expect(wrapper.find('[data-testid="agent-link-protocol-help-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-protocol-help-btn"]').text()).toContain(
      'Copy prompt to upgrade your MCP'
    )
    expect(wrapper.text()).not.toContain('tok-123')
    expect(wrapper.text()).not.toContain('Retry')
    expect(wrapper.text()).not.toMatch(/reconnect/i)
  })

  it('already_linked: renders the rejected notice with honest (no-fake-time) copy and actions', async () => {
    const wrapper = mountPanel({ state: 'already_linked' })

    const notice = wrapper.find('[data-testid="agent-link-notice"]')
    expect(notice.exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe(
      'This diagram is already linked'
    )
    expect(notice.text()).toContain(
      'Connecting another AI agent will end the current link. Your diagram is saved.'
    )
    expect(wrapper.find('[data-testid="agent-link-notice-revoke-btn"]').text()).toContain('Connect another AI agent')
    expect(wrapper.find('[data-testid="agent-link-notice-cancel-btn"]').exists()).toBe(false)

    await wrapper.find('[data-testid="agent-link-notice-revoke-btn"]').trigger('click')
    expect(wrapper.emitted('revoke')).toHaveLength(1)
  })

  it('already_linked: forwards lockExpiresAt to SessionNotice for an honest countdown', () => {
    const lockExpiresAt = Date.now() + 5 * 60 * 1000
    const wrapper = mountPanel({ state: 'already_linked', lockExpiresAt } as any)

    const notice = wrapper.find('[data-testid="agent-link-notice"]')
    expect(notice.text()).toContain('about 5 more min')
  })

  it('failed: renders a visible retryable mint-failure notice', () => {
    const wrapper = mountPanel({ state: 'failed' })

    const notice = wrapper.find('[data-testid="agent-link-notice"]')
    expect(notice.exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe('Could not start Agent Link')
    expect(notice.text()).toContain('Your diagram is unchanged. Try creating a new pairing.')
    expect(wrapper.find('[data-testid="agent-link-reconnect-btn"]').exists()).toBe(true)
  })

  // #314: the client-side TTL watchdog moves a stale session to 'expired'.
  it('expired: creates a new pairing rather than reusing an expired code', async () => {
    const wrapper = mountPanel({ state: 'expired' })

    const notice = wrapper.find('[data-testid="agent-link-notice"]')
    expect(notice.exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe('Connection expired')
    expect(notice.text()).toContain('Start a new connection when you are ready.')
    expect(notice.text()).not.toContain('diagram is saved')
    expect(notice.text()).not.toMatch(/reconnect/i)
    expect(wrapper.find('[data-testid="agent-link-reconnect-btn"]').text()).toBe('Connect')
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
    window.localStorage.clear()
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
    expect(header.find('[data-testid="agent-link-status-header-name"]').text()).toBe('Connected')
    expect(header.find('[data-testid="agent-link-live-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-client-carousel"]').exists()).toBe(false)
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

  it('passes lastActivityAt through to the connected and automatic-recovery status header', () => {
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

  it('suspended: shows only the compact amber connection header', () => {
    const wrapper = mountRail({
      state: 'suspended',
      diagramTitle: 'Checkout flow',
      clientName: 'Claude Code',
    })

    expect(wrapper.find('[data-testid="agent-link-status-header"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-status-header-name"]').text()).toBe('Claude Code')
    expect(wrapper.find('[data-testid="agent-link-live-badge-suspended"]').text()).toContain('Connecting')
    expect(wrapper.find('[data-testid="agent-link-client-brand-icon"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-thinking-banner"]').exists()).toBe(false)
    expect(wrapper.find('p').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(0)
  })

  it('closed (terminal): presents a neutral disconnected state and one Connect action', async () => {
    const wrapper = mountRail({ state: 'closed', diagramTitle: 'Checkout flow' })

    const notice = wrapper.find('[data-testid="agent-link-notice"]')
    expect(notice.exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe('Disconnected')
    expect(notice.text()).toContain('Start a new connection when you are ready.')
    expect(notice.text()).not.toMatch(/another agent|AI agent/i)
    expect(wrapper.find('[data-testid="agent-link-reconnect-btn"]').text()).toBe('Connect')
    // no footer actions in the terminal state — Connect is the only CTA
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(false)

    await wrapper.find('[data-testid="agent-link-reconnect-btn"]').trigger('click')
    expect(wrapper.emitted('reconnect')).toHaveLength(1)
  })

  it('already-linked rejection: shows the rejected notice and Revoke & re-link, not an empty rail', () => {
    const wrapper = mountRail({ state: 'already_linked', diagramTitle: 'Checkout flow' })

    expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain('agent-link-panel--already_linked')
    expect(wrapper.find('[data-testid="agent-link-notice"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe(
      'This diagram is already linked'
    )
    expect(wrapper.find('[data-testid="agent-link-notice-revoke-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-cancel-btn"]').exists()).toBe(false)
  })

  it('idle: gives one clear start action', () => {
    const wrapper = mountRail({ state: 'idle' })
    expect(wrapper.find('[data-testid="agent-link-panel"]').classes()).toContain('agent-link-panel--idle')
    expect(wrapper.find('[data-testid="agent-link-status-header"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-link-notice"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe('Connect')
    expect(wrapper.find('[data-testid="agent-link-reconnect-btn"]').text()).toBe('Connect')
    expect(wrapper.find('[data-testid="agent-link-disconnect-btn"]').exists()).toBe(false)
  })
})
