import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import FullscreenRecoveryGate from './FullscreenRecoveryGate.vue'
import type { RecoverySnapshot } from '../../../shared/fullscreenRecovery'
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: vi.fn() }))

const base = { state: 'not_requested', serverNow: '2026-10-24T00:00:00Z', policyVersion: 'fullscreen-contact-v1' } as const satisfies RecoverySnapshot

async function fillContact(wrapper: ReturnType<typeof mount>) {
  await wrapper.get('input[value="present"]').setValue(true)
  await wrapper.get('button.recovery__primary').trigger('click')
  await wrapper.get('input[type="email"]').setValue('reader@example.com')
  await wrapper.get('input[type="checkbox"][required]').setValue(true)
}

describe('FullscreenRecoveryGate', () => {
  it('requires a use case and a reply consent before saving, then opens without activating', async () => {
    const snapshot: RecoverySnapshot = {
      ...base, state: 'pending_activation',
      request: { id: 'FS-001', scenarios: ['present'], note: '', email: 'reader@example.com', createdAt: base.serverNow, mailState: 'queued' },
      grant: { id: 'grant-1', activatedAt: null, expiresAt: null },
    }
    const request = vi.fn().mockResolvedValue({ snapshot, outcome: 'created' })
    const wrapper = mount(FullscreenRecoveryGate, { props: { snapshot: base, request } })
    expect(wrapper.get('button.recovery__primary').attributes('disabled')).toBeDefined()
    await fillContact(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(request).toHaveBeenCalledWith(expect.objectContaining({
      action: 'request', scenarios: ['present'], email: 'reader@example.com', consent: true,
      consentVersion: 'fullscreen-contact-v1',
    }))
    expect(wrapper.text()).toContain('Your 7 days have not started')
    expect(wrapper.emitted('update:snapshot')?.[0]?.[0]).toEqual(snapshot)
    expect(wrapper.emitted('openFullscreen')).toBeUndefined()
    await wrapper.get('button.recovery__primary').trigger('click')
    expect(wrapper.emitted('openFullscreen')).toHaveLength(1)
  })

  it('keeps the completed form for retry after a request failure', async () => {
    const request = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ snapshot: { ...base, state: 'pending_activation', request: { id: 'FS-001', scenarios: ['present'], note: '', email: 'reader@example.com', createdAt: base.serverNow } } })
    const wrapper = mount(FullscreenRecoveryGate, { props: { snapshot: base, request } })
    await fillContact(wrapper)
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('could not save')
    expect(wrapper.get('input[type="email"]').element).toHaveProperty('value', 'reader@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(request).toHaveBeenCalledTimes(2)
    expect(wrapper.text()).toContain('Fullscreen is ready')
  })

  it('continues the existing expired request and uses only configured support email', async () => {
    const snapshot: RecoverySnapshot = {
      ...base, state: 'expired', supportEmail: 'support@example.com',
      request: { id: 'FS-001', scenarios: ['inspect_details'], note: 'private details', email: 'reader@example.com', createdAt: base.serverNow, mailState: 'queued' },
      grant: { id: 'grant-1', activatedAt: '2026-10-15T00:00:00Z', expiresAt: '2026-10-22T00:00:00Z' },
    }
    const wrapper = mount(FullscreenRecoveryGate, { props: { snapshot } })
    expect(wrapper.text()).toContain('Your temporary Fullscreen access has ended')
    await wrapper.get('button.recovery__primary').trigger('click')
    expect(wrapper.text()).toContain('Your request is saved. Support has not sent a reply yet.')
    expect(wrapper.text()).toContain('Current access ended')
    expect(wrapper.text()).toContain('private details')
    expect(wrapper.get('a').attributes('href')).toMatch(/^mailto:support@example\.com\?subject=/)
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('uses future tense for an active grant in the request view', () => {
    const snapshot: RecoverySnapshot = {
      ...base, state: 'active',
      request: { id: 'FS-001', scenarios: ['present'], note: '', email: 'reader@example.com', createdAt: base.serverNow, mailState: 'accepted' },
      grant: { id: 'grant-1', activatedAt: '2026-10-24T00:00:00Z', expiresAt: '2026-10-31T00:00:00Z' },
    }
    const wrapper = mount(FullscreenRecoveryGate, { props: { snapshot, initialView: 'request' } })
    expect(wrapper.text()).toContain('Current access ends')
    expect(wrapper.text()).not.toContain('Current access ended')
  })
})
