import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  clientDomain: 'example-tenant',
  forgeGlobal: {
    zenumlRemoteBaseUrl: 'https://backend.example.test',
    forgeContext: undefined as any,
  },
}))

vi.mock('@/utils/window', () => ({
  trackEvent: vi.fn(),
  serializeError: (e: any) => (e && e.message) || String(e),
}))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => state.clientDomain,
}))
vi.mock('@/model/globals/forgeGlobal', () => ({ default: state.forgeGlobal }))

import getFeatureFlags from './featureFlags'
import { trackEvent } from '@/utils/window'

const okResponse = (body: unknown) =>
  ({ ok: true, status: 200, statusText: 'OK', json: async () => body }) as Response

describe('getFeatureFlags (legacy get_feature_flags error event)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.mocked(trackEvent).mockClear()
    state.clientDomain = 'example-tenant'
    state.forgeGlobal.forgeContext = undefined
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(console, 'debug').mockImplementation(() => {})
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('returns the flags and records nothing on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse({ PAYWALL_EXEMPT: false })))
    await expect(getFeatureFlags(['PAYWALL_EXEMPT'])).resolves.toEqual({ PAYWALL_EXEMPT: false })
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('retries once after a network drop and records nothing when the retry succeeds', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse({ PAYWALL_EXEMPT: true }))
    vi.stubGlobal('fetch', fetchMock)

    const promise = getFeatureFlags(['PAYWALL_EXEMPT'])
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toEqual({ PAYWALL_EXEMPT: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(trackEvent).not.toHaveBeenCalled()
  })

  it('records one classified error after both attempts fail, keeping the legacy label', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)

    const promise = getFeatureFlags(['PAYWALL_EXEMPT'])
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toEqual({})
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(trackEvent).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(
      'Failed to fetch',
      'get_feature_flags',
      'error',
      expect.objectContaining({ error_kind: 'network', attempts: 2 }),
    )
  })

  it('does not record an error when the page is hidden/unloading (aborted request)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const spy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

    const promise = getFeatureFlags(['PAYWALL_EXEMPT'])
    await vi.runAllTimersAsync()

    await expect(promise).resolves.toEqual({})
    expect(trackEvent).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('does not retry an HTTP error and tags it as http', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: false, status: 503, statusText: 'Service Unavailable' } as Response)
    vi.stubGlobal('fetch', fetchMock)

    await expect(getFeatureFlags(['PAYWALL_EXEMPT'])).resolves.toEqual({})
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(trackEvent).toHaveBeenCalledWith(
      'Service Unavailable',
      'get_feature_flags',
      'error',
      expect.objectContaining({ error_kind: 'http', http_status: 503 }),
    )
  })

  it('empty client domain: no request, and the event says what the context looked like', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    state.clientDomain = ''
    state.forgeGlobal.forgeContext = { siteUrl: 'https://wiki.example.test' }

    await expect(getFeatureFlags(['PAYWALL_EXEMPT'])).resolves.toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith(
      'empty_client_domain',
      'get_feature_flags',
      'error',
      expect.objectContaining({ context_resolved: true, site_host_kind: 'other' }),
    )
  })

  it('empty client domain before the Forge context exists is reported as unresolved', async () => {
    vi.stubGlobal('fetch', vi.fn())
    state.clientDomain = ''
    state.forgeGlobal.forgeContext = undefined

    await getFeatureFlags(['PAYWALL_EXEMPT'])
    expect(trackEvent).toHaveBeenCalledWith(
      'empty_client_domain',
      'get_feature_flags',
      'error',
      expect.objectContaining({ context_resolved: false, site_host_kind: 'none' }),
    )
  })
})
