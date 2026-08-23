import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import LinkStatusChip from './LinkStatusChip.vue'

describe('LinkStatusChip', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it.each(['idle', 'waiting', 'timeout'] as const)(
    'renders nothing before a session exists (state=%s)',
    (state) => {
      const wrapper = mount(LinkStatusChip, { props: { state } })
      expect(wrapper.find('[data-testid="agent-link-status-chip"]').exists()).toBe(false)
    }
  )

  it('connected: shows "Linked", the bound diagram title, and the TTL countdown', () => {
    const wrapper = mount(LinkStatusChip, {
      props: {
        state: 'connected',
        diagramTitle: 'Checkout flow',
        expiresAt: Date.now() + (8 * 60 + 42) * 1000,
      },
    })
    const chip = wrapper.find('[data-testid="agent-link-status-chip"]')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('agent-chip--live')
    expect(chip.text()).toContain('Linked')
    expect(chip.text()).toContain('Checkout flow')
    expect(wrapper.find('[data-testid="agent-link-status-chip-ttl"]').text()).toContain('8:42')
  })

  it('connected: turns the TTL amber under 2 minutes', () => {
    const wrapper = mount(LinkStatusChip, {
      props: { state: 'connected', diagramTitle: 'Checkout flow', expiresAt: Date.now() + 78 * 1000 },
    })
    expect(wrapper.find('[data-testid="agent-link-status-chip"]').classes()).toContain('agent-chip--warn-ttl')
  })

  it('connected: omits the TTL countdown when the expiry is unknown', () => {
    const wrapper = mount(LinkStatusChip, {
      props: { state: 'connected', diagramTitle: 'Checkout flow', expiresAt: null },
    })
    expect(wrapper.find('[data-testid="agent-link-status-chip"]').text()).toContain('Checkout flow')
    expect(wrapper.find('[data-testid="agent-link-status-chip-ttl"]').exists()).toBe(false)
  })

  it('suspended: shows the lightweight "Connecting" chip', () => {
    const wrapper = mount(LinkStatusChip, { props: { state: 'suspended' } })
    const chip = wrapper.find('[data-testid="agent-link-status-chip"]')
    expect(chip.classes()).toContain('agent-chip--suspended')
    expect(chip.text()).toContain('Connecting')
    expect(chip.text()).not.toMatch(/reconnect/i)
  })

  it('closed: shows the gray "Disconnected" chip', () => {
    const wrapper = mount(LinkStatusChip, { props: { state: 'closed' } })
    const chip = wrapper.find('[data-testid="agent-link-status-chip"]')
    expect(chip.classes()).toContain('agent-chip--dead')
    expect(chip.text()).toContain('Disconnected')
  })

  // #314: the client-side TTL watchdog moves a stale session to 'expired' —
  // the toolbar chip must leave the green "live" variant and say so, not stay
  // pinned on a live look with a dead "0:00" countdown.
  it('expired: shows a muted "Expired" chip, not the live variant', () => {
    const wrapper = mount(LinkStatusChip, { props: { state: 'expired' } })
    const chip = wrapper.find('[data-testid="agent-link-status-chip"]')
    expect(chip.exists()).toBe(true)
    expect(chip.classes()).toContain('agent-chip--expired')
    expect(chip.classes()).not.toContain('agent-chip--live')
    expect(chip.text()).toContain('Expired')
  })
})
