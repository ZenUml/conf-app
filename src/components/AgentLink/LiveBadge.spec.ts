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
  it('renders a minimal accessible amber "Connecting" status when suspended', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'suspended' } })

    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
    const badge = wrapper.find('[data-testid="agent-link-live-badge-suspended"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Connecting')
    expect(badge.attributes('role')).toBe('status')
    expect(badge.attributes('aria-live')).toBe('polite')
    expect(badge.attributes('aria-label')).toBe('Connecting AI assistant')
  })

  it('renders the gray "Disconnected" variant when closed (terminal)', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'closed' } })

    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
    const badge = wrapper.find('[data-testid="agent-link-live-badge-closed"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Disconnected')
  })

  // #314: the client-side TTL watchdog moves a stale session to 'expired' —
  // the collapsed-macro badge must not keep showing "● live" once that
  // happens.
  it('renders the muted "Expired" variant when expired, and never the "● live" indicator', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'expired' } })

    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
    const badge = wrapper.find('[data-testid="agent-link-live-badge-expired"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Expired')
  })

  // Track H: additive "Working" variant for an op in flight on a live session
  // (the rail status header passes `thinking`). The collapsed-macro usage never
  // passes it, so the green "live" rendering above is untouched.
  it('renders the blue "Working" variant when connected AND thinking', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'connected', thinking: true } })

    const working = wrapper.find('[data-testid="agent-link-live-badge-working"]')
    expect(working.exists()).toBe(true)
    expect(working.text()).toContain('Working')
    // The green "live" badge must yield to "Working" while an op is in flight.
    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
  })

  it('keeps the green "live" badge when connected without thinking (default)', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'connected', thinking: false } })

    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-live-badge-working"]').exists()).toBe(false)
  })
})
