import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import SessionNotice from './SessionNotice.vue'

describe('SessionNotice', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-07-10T00:00:00Z'))
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('rejected variant', () => {
    it('never shows the fabricated "A session started N min ago is still active" copy', () => {
      const wrapper = mount(SessionNotice, { props: { variant: 'rejected' } })
      // The old fabricated line invented a start time the client never knew.
      expect(wrapper.text()).not.toContain('A session started')
      expect(wrapper.text()).not.toContain('is still active')
    })

    it('without lockExpiresAt: shows the generic no-fake-time copy', () => {
      const wrapper = mount(SessionNotice, { props: { variant: 'rejected' } })
      expect(wrapper.text()).toContain(
        'Connecting another AI agent will end the current link. Your diagram is saved.'
      )
    })

    it('with a future lockExpiresAt: shows an honest ~N min countdown (ceil minutes)', () => {
      // 4 min 30 s out → ceil to 5 min.
      const lockExpiresAt = Date.now() + (4 * 60 + 30) * 1000
      const wrapper = mount(SessionNotice, { props: { variant: 'rejected', lockExpiresAt } })
      expect(wrapper.text()).toContain(
        'Another AI agent has this link for about 5 more min. Connecting another agent will end that link.'
      )
    })

    it('with lockExpiresAt already in the past: falls back to the generic copy, not a negative/zero countdown', () => {
      const wrapper = mount(SessionNotice, {
        props: { variant: 'rejected', lockExpiresAt: Date.now() - 1000 },
      })
      expect(wrapper.text()).toContain(
        'Connecting another AI agent will end the current link. Your diagram is saved.'
      )
      expect(wrapper.text()).not.toContain('more min')
    })

    it('with lockExpiresAt null: shows the generic copy', () => {
      const wrapper = mount(SessionNotice, { props: { variant: 'rejected', lockExpiresAt: null } })
      expect(wrapper.text()).toContain(
        'Connecting another AI agent will end the current link. Your diagram is saved.'
      )
    })
  })

  it('expired variant offers one new-pairing action', () => {
    const wrapper = mount(SessionNotice, { props: { variant: 'expired' } })
    expect(wrapper.text()).toContain('Connection expired')
    expect(wrapper.text()).toContain('Start a new connection when you are ready.')
    expect(wrapper.text()).not.toContain('diagram is saved')
    expect(wrapper.text()).not.toMatch(/reconnect/i)
    expect(wrapper.findAll('button')).toHaveLength(1)
    expect(wrapper.find('button').text()).toBe('Connect')
  })

  it('closed variant stays neutral and does not introduce switching language', () => {
    const wrapper = mount(SessionNotice, { props: { variant: 'closed' } })
    expect(wrapper.find('[data-testid="agent-link-notice-title"]').text()).toBe('Disconnected')
    expect(wrapper.find('button').text()).toBe('Connect')
    expect(wrapper.text()).not.toMatch(/another agent|AI agent/i)
  })
})
