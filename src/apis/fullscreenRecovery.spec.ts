import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))
import { callRemote } from '@/utils/requestUtil'
import { activateFullscreenRecovery, getFullscreenRecovery, requestFullscreenRecovery } from './fullscreenRecovery'

describe('fullscreen recovery Forge adapter', () => {
  beforeEach(() => vi.mocked(callRemote).mockReset())

  it('reads the authenticated viewer snapshot through the Forge remote', async () => {
    const snapshot = { state: 'not_requested', serverNow: '2026-10-24T00:00:00Z', policyVersion: 'fullscreen-contact-v1' }
    vi.mocked(callRemote).mockResolvedValue({ snapshot })
    await expect(getFullscreenRecovery()).resolves.toEqual(snapshot)
    expect(callRemote).toHaveBeenCalledWith('/api/fullscreen-recovery', 'GET')
  })

  it('posts request and activation as separate actions to the same endpoint', async () => {
    vi.mocked(callRemote).mockResolvedValue({ snapshot: { state: 'pending_activation', serverNow: '2026-10-24T00:00:00Z', policyVersion: 'fullscreen-contact-v1' } })
    const request = { action: 'request' as const, attemptId: 'request-id', scenarios: ['present'] as const, note: '', email: 'reader@example.com', consent: true as const, consentVersion: 'fullscreen-contact-v1' as const }
    const activate = { action: 'activate' as const, attemptId: 'activation-id', requestId: 'request-id' }
    await requestFullscreenRecovery({ ...request, scenarios: [...request.scenarios] })
    await activateFullscreenRecovery(activate)
    expect(callRemote).toHaveBeenNthCalledWith(1, '/api/fullscreen-recovery', 'POST', { ...request, scenarios: ['present'] })
    expect(callRemote).toHaveBeenNthCalledWith(2, '/api/fullscreen-recovery', 'POST', activate)
  })

  it('rejects a malformed response so the caller can keep existing access', async () => {
    vi.mocked(callRemote).mockResolvedValue('<html>not an API response</html>')
    await expect(getFullscreenRecovery()).rejects.toThrow('Invalid Fullscreen recovery response')
  })
})
