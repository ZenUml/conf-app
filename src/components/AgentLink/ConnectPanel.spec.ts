import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ConnectPanel from './ConnectPanel.vue'
import connectPanelSource from './ConnectPanel.vue?raw'
import type { AgentLinkActivityEntry } from '@/composables/agentLink/useAgentLinkSession'

function mountPanel(props: {
  state: 'idle' | 'waiting' | 'connected' | 'timeout' | 'closed'
  token?: string | null
  activityFeed?: AgentLinkActivityEntry[]
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
    expect(prompt).toContain('reads this page')
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
    expect(wrapper.find('[data-testid="agent-link-open-fullscreen-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-session-line"]').text()).toContain('tok-123')
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
      'claude mcp add --transport http zenuml https://zenapi.zenuml.com/agent-link/mcp'
    )
    expect(wrapper.find('[data-testid="agent-link-add-cursor-btn"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-no-install-link"]').exists()).toBe(true)
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

  it('Open fullscreen emits the open-fullscreen event', async () => {
    const wrapper = mountPanel({ state: 'connected', token: 'tok-123' })

    await wrapper.find('[data-testid="agent-link-open-fullscreen-btn"]').trigger('click')

    expect(wrapper.emitted('open-fullscreen')).toHaveLength(1)
  })
})
