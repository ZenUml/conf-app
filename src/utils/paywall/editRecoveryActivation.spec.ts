import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ activate: vi.fn(), track: vi.fn() }))
vi.mock('@/apis/fullscreenRecovery', () => ({ activateFullscreenRecovery: mocks.activate }))
vi.mock('@/utils/analytics/trackAnalyticsEvent', () => ({ trackAnalyticsEvent: mocks.track }))

import { activateEditRecoveryAfterSave, clearEditActivation, registerEditActivation } from './editRecoveryActivation'

const snapshot = { state: 'active', serverNow: '2026-12-08T09:00:00Z', policyVersion: 'edit-contact-v1' }
beforeEach(() => { vi.clearAllMocks(); vi.useRealTimers(); clearEditActivation() })

describe('edit access starts at the first successful save', () => {
  it('does nothing when the editor was opened without a pending edit request', async () => {
    await activateEditRecoveryAfterSave()
    expect(mocks.activate).not.toHaveBeenCalled()
  })
  it('activates the registered request once, as feature edit, and reports the new snapshot', async () => {
    const onActivated = vi.fn()
    mocks.activate.mockResolvedValue({ snapshot, outcome: 'activated' })
    registerEditActivation({ requestId: 'req-1', spaceKey: 'ENG', attemptId: 'att-1', onActivated })
    await activateEditRecoveryAfterSave()
    await activateEditRecoveryAfterSave()
    expect(mocks.activate).toHaveBeenCalledTimes(1)
    expect(mocks.activate).toHaveBeenCalledWith({ action: 'activate', attemptId: 'att-1', requestId: 'req-1', spaceKey: 'ENG', feature: 'edit' })
    expect(onActivated).toHaveBeenCalledWith(snapshot)
  })
  it('never fails the save: an error is swallowed, reported, and retried by the next save', async () => {
    mocks.activate.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ snapshot })
    registerEditActivation({ requestId: 'req-1', spaceKey: 'ENG', attemptId: 'att-1' })
    await expect(activateEditRecoveryAfterSave()).resolves.toBeUndefined()
    expect(mocks.track).toHaveBeenCalledWith('fullscreen_recovery_activation_failed', expect.objectContaining({
      feature: 'edit', surface: 'editor', failure_stage: 'confirmation', recovery_request_id: 'req-1' }))
    await activateEditRecoveryAfterSave()
    expect(mocks.activate).toHaveBeenCalledTimes(2)
  })
  it('does not hold the save for more than a few seconds when the request hangs', async () => {
    vi.useFakeTimers()
    mocks.activate.mockReturnValue(new Promise(() => {}))
    registerEditActivation({ requestId: 'req-1', spaceKey: 'ENG', attemptId: 'att-1' })
    const done = activateEditRecoveryAfterSave()
    await vi.advanceTimersByTimeAsync(3_500)
    await expect(done).resolves.toBeUndefined()
  })
})
