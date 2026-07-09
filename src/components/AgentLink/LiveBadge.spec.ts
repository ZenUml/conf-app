import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LiveBadge from './LiveBadge.vue'

describe('LiveBadge', () => {
  it('renders when connected', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'connected' } })

    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('live')
  })

  it.each(['idle', 'waiting', 'timeout'] as const)(
    'is hidden when state is %s',
    (state) => {
      const wrapper = mount(LiveBadge, { props: { state } })

      expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="agent-link-live-badge-suspended"]').exists()).toBe(false)
      expect(wrapper.find('[data-testid="agent-link-live-badge-closed"]').exists()).toBe(false)
    }
  )

  // Track G: extends LiveBadge with 'suspended'/'closed' variants — additive,
  // so the original 'connected' rendering (asserted above) and the
  // idle/waiting/timeout hidden states are untouched (collapsed-macro usage
  // keeps working exactly as before).
  it('renders the amber "Paused" variant when suspended (still resumable)', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'suspended' } })

    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
    const badge = wrapper.find('[data-testid="agent-link-live-badge-suspended"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Paused')
  })

  it('renders the gray "Disconnected" variant when closed (terminal)', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'closed' } })

    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
    const badge = wrapper.find('[data-testid="agent-link-live-badge-closed"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Disconnected')
  })
})
