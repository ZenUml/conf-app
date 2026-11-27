import { describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import FullscreenRecoveryGate from './FullscreenRecoveryGate.vue'
import type { RecoverySnapshot } from '../../../shared/fullscreenRecovery'
const track = vi.hoisted(() => vi.fn())
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: track }))

// The same panel as Fullscreen, with edit wording (Figma 06.10E; spec "One gate, two features").
const base: RecoverySnapshot = { state: 'not_requested', serverNow: '2026-12-08T09:00:00Z', policyVersion: 'edit-contact-v1', limit: 100 }
const saved = (state: RecoverySnapshot['state'], grant = { id: 'g', activatedAt: null as string | null, expiresAt: null as string | null }): RecoverySnapshot => ({
  ...base, state, grant,
  request: { id: 'EDIT-001', scenarios: ['fix_or_update'], note: '', email: 'reader@example.com', createdAt: base.serverNow, mailState: 'queued' },
})
const mountEdit = (snapshot: RecoverySnapshot, extra: Record<string, unknown> = {}) =>
  mount(FullscreenRecoveryGate, { props: { snapshot, feature: 'edit', context: { spaceKey: 'ENG' }, ...extra } })

describe('edit wording on the shared gate', () => {
  it('E1: "How will you edit diagrams?" with the four edit uses and the free limit', () => {
    const w = mountEdit(base)
    expect(w.get('h1').text()).toBe('How will you edit diagrams?')
    expect(w.text()).toContain('This site has reached the free limit of 100 diagrams.')
    expect(w.findAll('.recovery__choice').map(c => c.text())).toEqual([
      'Fix or update a diagram', 'Keep our documentation current', 'Prepare for a review or release', 'Something else',
    ])
    expect(w.text()).not.toMatch(/Fullscreen/)
  })
  it('submits an edit request: feature, edit scenarios and edit-contact-v1; editor surface in analytics', async () => {
    const request = vi.fn().mockResolvedValue({ snapshot: saved('pending_activation') })
    const w = mountEdit(base, { request })
    await w.get('input[value="fix_or_update"]').setValue(true)
    await w.get('button.recovery__primary').trigger('click')
    await w.get('input[type="email"]').setValue('reader@example.com')
    await w.get('input[type="checkbox"][required]').setValue(true)
    await w.get('form').trigger('submit'); await flushPromises()
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ feature: 'edit', scenarios: ['fix_or_update'], consentVersion: 'edit-contact-v1', spaceKey: 'ENG' }))
    expect(track).toHaveBeenCalledWith('fullscreen_recovery_request_submitted', expect.objectContaining({ feature: 'edit', surface: 'editor', policy_version: 'edit-contact-v1' }))
    expect(w.get('h1').text()).toBe('Editing is ready')
  })
  it('E2: "Editing is ready" with "Open editor"; the 7 days start at the first save', () => {
    const w = mountEdit(saved('pending_activation'))
    expect(w.get('h1').text()).toBe('Editing is ready')
    expect(w.text()).toContain('first save')
    expect(w.get('button.recovery__primary').text()).toBe('Open editor')
  })
  it('E4: "Your temporary editing access has ended"', () => {
    const w = mountEdit(saved('expired', { id: 'g', activatedAt: '2026-12-08T09:00:00Z', expiresAt: '2026-12-15T09:00:00Z' }))
    expect(w.get('h1').text()).toBe('Your temporary editing access has ended')
    expect(w.text()).not.toMatch(/Fullscreen/)
  })
})
