import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import LiveBadge from './LiveBadge.vue'

describe('LiveBadge', () => {
  it('renders when connected', () => {
    const wrapper = mount(LiveBadge, { props: { state: 'connected' } })

    expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('live')
  })

  it.each(['idle', 'waiting', 'timeout', 'closed'] as const)(
    'is hidden when state is %s',
    (state) => {
      const wrapper = mount(LiveBadge, { props: { state } })

      expect(wrapper.find('[data-testid="agent-link-live-badge"]').exists()).toBe(false)
    }
  )
})
