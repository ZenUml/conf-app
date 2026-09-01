import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LiveBadge from './LiveBadge.vue'

describe('LiveBadge', () => {
  it('renders the quiet connected signal', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'connected' } })
    const badge = wrapper.find('[data-testid="agent-link-live-badge"]')

    expect(badge.exists()).toBe(true)
    expect(badge.text()).toBe('Connected')
    expect(wrapper.find('.agent-link-live-badge__dot').exists()).toBe(true)
    expect(badge.attributes('aria-label')).toBe('AI assistant connected')
  })

  it.each(['idle', 'waiting', 'timeout'] as const)('is hidden when state is %s', (state) => {
    const wrapper = mount(LiveBadge, { props: { state } })
    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-link-live-badge-suspended"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="agent-link-live-badge-closed"]').exists()).toBe(false)
  })

  it('renders a minimal accessible amber Connecting status during automatic recovery', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'suspended' } })
    const badge = wrapper.find('[data-testid="agent-link-live-badge-suspended"]')

    expect(badge.text()).toBe('Connecting')
    expect(badge.attributes('role')).toBe('status')
    expect(badge.attributes('aria-live')).toBe('polite')
    expect(badge.attributes('aria-label')).toBe('Connecting AI assistant')
  })

  it('renders terminal states without a connected signal', () => {
    const closed = mount(LiveBadge, { props: { state: 'closed' } })
    const expired = mount(LiveBadge, { props: { state: 'expired' } })

    expect(closed.find('[data-testid="agent-link-live-badge-closed"]').text()).toBe('Disconnected')
    expect(expired.find('[data-testid="agent-link-live-badge-expired"]').text()).toBe('Expired')
    expect(expired.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
  })

  it('declares a reduced-motion fallback for the automatic-recovery wave', async () => {
    const source = (await import('./LiveBadge.vue?raw')).default
    expect(source).toContain('@media (prefers-reduced-motion: reduce)')
    expect(source).toContain('agent-link-connecting-wave')
  })
})
