import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentStatusHeader from './AgentStatusHeader.vue'
import { ACTIVITY_LINGER_MS } from '@/composables/agentLink/useAgentLinkSession'

describe('AgentStatusHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  function sublineText(wrapper: ReturnType<typeof mount>) {
    return wrapper.find('.agent-status-header__sub').text()
  }

  it('uses calm activity copy without repeating Connected', async () => {
    const wrapper = mount(AgentStatusHeader, {
      props: { state: 'connected', lastActivityAt: Date.now() },
    })
    expect(ACTIVITY_LINGER_MS).toBe(5000)
    expect(sublineText(wrapper)).toBe('Active now')

    await vi.advanceTimersByTimeAsync(8000)
    expect(sublineText(wrapper)).toBe('Active 8s ago')

    await vi.advanceTimersByTimeAsync(82_000)
    expect(sublineText(wrapper)).toBe('Active 1m ago')
  })

  it('puts current editing in the compact subline and retains the Connected signal', () => {
    const wrapper = mount(AgentStatusHeader, {
      props: { state: 'connected', thinking: true, lastActivityAt: Date.now() },
    })

    expect(sublineText(wrapper)).toBe('Editing now')
    expect(wrapper.find('[data-testid="agent-link-live-badge"]').text()).toBe('Connected')
  })

  it('uses a capability fallback when activity time is absent', () => {
    const wrapper = mount(AgentStatusHeader, { props: { state: 'connected' } })
    expect(sublineText(wrapper)).toBe('Reads & edits')
  })

  it.each([
    ['Claude Code', 'Claude Code'],
    ['claude-code', 'Claude Code'],
    ['Cursor', 'Cursor'],
    ['cursor-client', 'Cursor'],
  ])('normalizes %s to the recognized %s mark and label', (clientName, label) => {
    const wrapper = mount(AgentStatusHeader, { props: { state: 'connected', clientName } })
    expect(wrapper.find('[data-testid="agent-link-client-brand-icon"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-status-header-name"]').text()).toBe(label)
    expect(wrapper.find('[data-client-brand]').attributes('data-client-brand')).toBe(label)
  })

  it.each(['unknown-client', 'Codex impostor', ''])(
    'uses the neutral connection glyph without rendering raw value %s',
    (clientName) => {
      const wrapper = mount(AgentStatusHeader, { props: { state: 'connected', clientName } })
      expect(wrapper.find('[data-testid="agent-link-client-generic-icon"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="agent-link-client-brand-icon"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="agent-link-status-header-name"]').text()).toBe('AI assistant')
      expect(wrapper.text()).not.toContain(clientName || 'unknown-client')
    }
  )

  it.each(['Codex', 'codex-mcp-client'])('uses the installed Codex mark for %s', (clientName) => {
    const wrapper = mount(AgentStatusHeader, { props: { state: 'connected', clientName } })
    expect(wrapper.find('[data-testid="agent-link-status-header-name"]').text()).toBe('Codex')
    const icon = wrapper.find('[data-testid="agent-link-client-brand-icon"]')
    expect(icon.exists()).toBe(true)
    expect(icon.element.tagName).toBe('IMG')
  })

  it('automatic recovery changes only the status badge, not client identity copy', () => {
    const connected = mount(AgentStatusHeader, {
      props: { state: 'connected', clientName: 'claude-code', lastActivityAt: Date.now() },
    })
    const recovering = mount(AgentStatusHeader, {
      props: { state: 'suspended', clientName: 'claude-code', lastActivityAt: Date.now() },
    })

    expect(recovering.find('[data-testid="agent-link-status-header-name"]').text()).toBe(
      connected.find('[data-testid="agent-link-status-header-name"]').text()
    )
    expect(sublineText(recovering)).toBe(sublineText(connected))
    expect(recovering.find('[data-testid="agent-link-live-badge-suspended"]').text()).toBe('Connecting')
  })
})
