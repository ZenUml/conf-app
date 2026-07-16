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
        'Another agent session holds this diagram. Only one agent can hold the link at a time.'
      )
    })

    it('with a future lockExpiresAt: shows an honest ~N min countdown (ceil minutes)', () => {
      // 4 min 30 s out → ceil to 5 min.
      const lockExpiresAt = Date.now() + (4 * 60 + 30) * 1000
      const wrapper = mount(SessionNotice, { props: { variant: 'rejected', lockExpiresAt } })
      expect(wrapper.text()).toContain(
        'Another agent session holds this diagram — it expires in ~5 min. Only one agent can hold the link at a time.'
      )
    })

    it('with lockExpiresAt already in the past: falls back to the generic copy, not a negative/zero countdown', () => {
      const wrapper = mount(SessionNotice, {
        props: { variant: 'rejected', lockExpiresAt: Date.now() - 1000 },
      })
      expect(wrapper.text()).toContain(
        'Another agent session holds this diagram. Only one agent can hold the link at a time.'
      )
      expect(wrapper.text()).not.toContain('expires in')
    })

    it('with lockExpiresAt null: shows the generic copy', () => {
      const wrapper = mount(SessionNotice, { props: { variant: 'rejected', lockExpiresAt: null } })
      expect(wrapper.text()).toContain(
        'Another agent session holds this diagram. Only one agent can hold the link at a time.'
      )
    })
  })

  it('expired variant is unaffected by lockExpiresAt copy changes', () => {
    const wrapper = mount(SessionNotice, { props: { variant: 'expired' } })
    expect(wrapper.text()).toContain('Your session ended. Your diagram is saved — nothing was lost.')
  })
})
