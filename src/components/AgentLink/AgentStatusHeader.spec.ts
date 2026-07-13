import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import AgentStatusHeader from './AgentStatusHeader.vue'
import { ACTIVITY_LINGER_MS } from '@/composables/agentLink/useAgentLinkSession'

describe('AgentStatusHeader', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  function sublineText(wrapper: ReturnType<typeof mount>) {
    return wrapper.find('.agent-status-header__sub').text()
  }

  it('shows the active connected subline for fresh activity', () => {
    const wrapper = mount(AgentStatusHeader, {
      props: { state: 'connected', lastActivityAt: Date.now() },
    })

    expect(ACTIVITY_LINGER_MS).toBe(5000)
    expect(sublineText(wrapper)).toBe('Connected · agent active')
  })

  it('adds a whole-seconds ago suffix after activity leaves the active window', async () => {
    const wrapper = mount(AgentStatusHeader, {
      props: { state: 'connected', lastActivityAt: Date.now() },
    })

    await vi.advanceTimersByTimeAsync(8000)

    expect(sublineText(wrapper)).toBe('Connected · agent active · 8s ago')
  })

  it('switches the inactive suffix to whole minutes past 60 seconds', async () => {
    const wrapper = mount(AgentStatusHeader, {
      props: { state: 'connected', lastActivityAt: Date.now() },
    })

    await vi.advanceTimersByTimeAsync(90_000)

    expect(sublineText(wrapper)).toBe('Connected · agent active · 1m ago')
  })

  it('lets thinking take precedence over the activity subline', () => {
    const wrapper = mount(AgentStatusHeader, {
      props: { state: 'connected', thinking: true, lastActivityAt: Date.now() },
    })

    expect(sublineText(wrapper)).toBe('Connected · reads & edits')
    expect(wrapper.find('[data-testid="agent-link-live-badge-working"]').exists()).toBe(true)
  })

  it('keeps the connected capability fallback when lastActivityAt is absent', () => {
    const wrapper = mount(AgentStatusHeader, {
      props: { state: 'connected' },
    })

    expect(sublineText(wrapper)).toBe('Connected · reads & edits')
  })
})
