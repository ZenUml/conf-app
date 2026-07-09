import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionTtl from './SessionTtl.vue'

describe('SessionTtl', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders nothing when the expiry is unknown (null)', () => {
    const wrapper = mount(SessionTtl, { props: { expiresAt: null } })
    expect(wrapper.find('[data-testid="agent-link-ttl"]').exists()).toBe(false)
  })

  it('formats the remaining time as M:SS and labels it "Token expires in"', () => {
    // 8 min 42 s from now → 8:42 (matches the design preview).
    const wrapper = mount(SessionTtl, { props: { expiresAt: Date.now() + (8 * 60 + 42) * 1000 } })
    expect(wrapper.find('[data-testid="agent-link-ttl"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('Token expires in')
    expect(wrapper.find('[data-testid="agent-link-ttl-value"]').text()).toBe('8:42')
  })

  it('does not apply the amber warning above the 120s threshold', () => {
    const wrapper = mount(SessionTtl, { props: { expiresAt: Date.now() + 130 * 1000 } })
    expect(wrapper.find('.agent-ttl--warn').exists()).toBe(false)
  })

  it('applies the amber warning under 120s remaining', () => {
    const wrapper = mount(SessionTtl, { props: { expiresAt: Date.now() + 78 * 1000 } })
    expect(wrapper.find('[data-testid="agent-link-ttl-value"]').text()).toBe('1:18')
    expect(wrapper.find('.agent-ttl--warn').exists()).toBe(true)
  })

  it('clamps to 0:00 once the expiry has passed', () => {
    const wrapper = mount(SessionTtl, { props: { expiresAt: Date.now() - 5000 } })
    expect(wrapper.find('[data-testid="agent-link-ttl-value"]').text()).toBe('0:00')
  })
})
