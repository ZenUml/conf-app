import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LiveBadge from './LiveBadge.vue'

describe('LiveBadge', () => {
  it('renders when connected', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'connected' } })

    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(true)
    expect(wrapper.text()).toBe('Connected')
    expect(wrapper.find('.agent-link-live-badge__dot').exists()).toBe(true)
    expect(wrapper.find('[data-testid="agent-link-live-badge"]').attributes('aria-label')).toBe(
      'AI assistant connected'
    )
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

  // Automatic recovery changes the connected signal without adding a panel.
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
  // the collapsed-macro badge must not keep showing "Connected" once that
  // happens.
  it('renders the muted "Expired" variant when expired, and never the connected indicator', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'expired' } })

    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
    const badge = wrapper.find('[data-testid="agent-link-live-badge-expired"]')
    expect(badge.exists()).toBe(true)
    expect(badge.text()).toContain('Expired')
  })

  it('uses an amber wave only for automatic recovery and declares a reduced-motion fallback', async () => {
    const wrapper = mount(LiveBadge, { props: { state: 'suspended' } })
    expect(wrapper.find('.agent-link-live-badge__dot').exists()).toBe(true)
    expect((await import('./LiveBadge.vue?raw')).default).toContain('@media (prefers-reduced-motion: reduce)')
    expect((await import('./LiveBadge.vue?raw')).default).toContain('agent-link-connecting-wave')
  })
})
