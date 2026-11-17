import { beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@/utils/requestUtil', () => ({ callRemote: vi.fn() }))
import { callRemote } from '@/utils/requestUtil'
import { activateFullscreenRecovery, getFullscreenRecovery, requestFullscreenRecovery } from './fullscreenRecovery'

// Wire format for the Fullscreen feature must stay byte-identical so cached old clients and the
// current backend agree: no `feature` in the URL or in either body.
const snapshot = { state: 'not_requested', serverNow: '2026-10-24T00:00:00Z', policyVersion: 'fullscreen-contact-v1' }

describe('fullscreen recovery wire format', () => {
  beforeEach(() => vi.mocked(callRemote).mockReset())

  it('GET without a space key is the bare endpoint', async () => {
    vi.mocked(callRemote).mockResolvedValue({ snapshot })
    await getFullscreenRecovery()
    expect(vi.mocked(callRemote).mock.calls).toEqual([['/api/fullscreen-recovery', 'GET']])
  })

  it('GET with a space key carries only spaceKey', async () => {
    vi.mocked(callRemote).mockResolvedValue({ snapshot })
    await getFullscreenRecovery('ENG')
    expect(vi.mocked(callRemote).mock.calls).toEqual([['/api/fullscreen-recovery?spaceKey=ENG', 'GET']])
  })

  it('request and activation bodies are sent exactly as given, without a feature key', async () => {
    vi.mocked(callRemote).mockResolvedValue({ snapshot: { ...snapshot, state: 'pending_activation' } })
    const request = { action: 'request' as const, attemptId: 'a', scenarios: ['present' as const], note: '', email: 'r@example.com', spaceKey: 'ENG', consent: true as const, consentVersion: 'fullscreen-contact-v1' as const }
    const activate = { action: 'activate' as const, attemptId: 'b', requestId: 'c', spaceKey: 'ENG' }
    await requestFullscreenRecovery(request)
    await activateFullscreenRecovery(activate)
    const calls = vi.mocked(callRemote).mock.calls
    expect(calls.map(call => [call[0], call[1]])).toEqual([['/api/fullscreen-recovery', 'POST'], ['/api/fullscreen-recovery', 'POST']])
    expect(JSON.stringify(calls[0][2])).toBe(JSON.stringify(request))
    expect(JSON.stringify(calls[1][2])).toBe(JSON.stringify(activate))
  })
})
