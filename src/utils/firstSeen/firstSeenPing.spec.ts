import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mutable mocks shared with the hoisted vi.mock factories below
// (same rig as utils/paywall/spaceAdminProbe.spec.ts).
const h = vi.hoisted(() => ({
  initializeContext: vi.fn().mockResolvedValue(undefined),
  callRemote: vi.fn(),
  forge: { forgeContext: { accountId: 'user-self', cloudId: 'cloud-1' } as any },
}))

vi.mock('@/model/globals', () => ({
  default: { apWrapper: { initializeContext: h.initializeContext } },
}))
vi.mock('@/model/globals/forgeGlobal', () => ({ default: h.forge }))
vi.mock('@/utils/requestUtil', () => ({ callRemote: h.callRemote }))
vi.mock('@/utils/ContextParameters/ContextParameters', () => ({
  getClientDomain: () => 'example-tenant',
}))

import {
  FIRST_SEEN_WINDOW_MS,
  FIRST_SEEN_RETRY_BACKOFF_MS,
  firstSeenMarkerKey,
  parseFirstSeenMarker,
  isFirstSeenDue,
  isWithinFirstSeenBackoff,
  maybeSendFirstSeenPing,
  type FirstSeenMarker,
} from './firstSeenPing'

const NOW = Date.parse('2026-08-09T12:00:00.000Z')

function storedMarker(): FirstSeenMarker | null {
  return parseFirstSeenMarker(localStorage.getItem(firstSeenMarkerKey()))
}

beforeEach(() => {
  localStorage.clear()
  vi.clearAllMocks()
  h.forge.forgeContext = { accountId: 'user-self', cloudId: 'cloud-1' }
  h.callRemote.mockResolvedValue({})
})

describe('marker parsing and due logic', () => {
  it('null / malformed / wrong-shape raw values parse to null (=> due)', () => {
    expect(parseFirstSeenMarker(null)).toBeNull()
    expect(parseFirstSeenMarker('not json')).toBeNull()
    expect(parseFirstSeenMarker('{}')).toBeNull()
    expect(parseFirstSeenMarker(JSON.stringify({ sentAt: '2026-08-01T00:00:00Z' }))).toBeNull() // no accountId
    expect(isFirstSeenDue(null, NOW)).toBe(true)
  })

  it('a marker inside the 30-day window is not due; outside it is', () => {
    const inside: FirstSeenMarker = {
      sentAt: new Date(NOW - FIRST_SEEN_WINDOW_MS + 60_000).toISOString(),
      accountId: 'user-self',
    }
    const outside: FirstSeenMarker = {
      sentAt: new Date(NOW - FIRST_SEEN_WINDOW_MS - 60_000).toISOString(),
      accountId: 'user-self',
    }
    expect(isFirstSeenDue(inside, NOW)).toBe(false)
    expect(isFirstSeenDue(outside, NOW)).toBe(true)
  })

  it('an unparseable sentAt is due (fail open into a retry, never a permanent block)', () => {
    expect(isFirstSeenDue({ sentAt: 'garbage', accountId: 'a' }, NOW)).toBe(true)
  })
})

describe('maybeSendFirstSeenPing', () => {
  it('happy path: POSTs the census event and writes the marker with the accountId', async () => {
    await maybeSendFirstSeenPing(NOW)

    expect(h.callRemote).toHaveBeenCalledWith(
      '/forge-user-behavior',
      'POST',
      expect.objectContaining({ eventType: 'app_first_seen', atlassianId: 'user-self' })
    )
    expect(storedMarker()).toMatchObject({ accountId: 'user-self' })
  })

  it('inside the 30-day window: exits before context init, no POST', async () => {
    await maybeSendFirstSeenPing(NOW)
    vi.clearAllMocks()

    await maybeSendFirstSeenPing(NOW + 1000)

    expect(h.initializeContext).not.toHaveBeenCalled()
    expect(h.callRemote).not.toHaveBeenCalled()
  })

  it('after the window expires it pings again', async () => {
    await maybeSendFirstSeenPing(NOW)
    vi.clearAllMocks()

    await maybeSendFirstSeenPing(NOW + FIRST_SEEN_WINDOW_MS + 61_000)

    expect(h.callRemote).toHaveBeenCalledTimes(1)
  })

  it('census rule: null accountId => no POST, no marker, no attempt stamp (free retry next load)', async () => {
    h.forge.forgeContext = { accountId: undefined }

    await maybeSendFirstSeenPing(NOW)

    expect(h.callRemote).not.toHaveBeenCalled()
    expect(storedMarker()).toBeNull()
    expect(isWithinFirstSeenBackoff(NOW + 1)).toBe(false)
  })

  it('POST failure: no marker, but the attempt stamp enforces the 10-minute backoff', async () => {
    h.callRemote.mockRejectedValue(new Error('HTTP 500'))

    await maybeSendFirstSeenPing(NOW)
    expect(storedMarker()).toBeNull()

    // Within backoff: no second POST even though no marker exists.
    vi.clearAllMocks()
    h.callRemote.mockResolvedValue({})
    await maybeSendFirstSeenPing(NOW + FIRST_SEEN_RETRY_BACKOFF_MS - 1000)
    expect(h.callRemote).not.toHaveBeenCalled()

    // Past backoff: retries and succeeds.
    await maybeSendFirstSeenPing(NOW + FIRST_SEEN_RETRY_BACKOFF_MS + 1000)
    expect(h.callRemote).toHaveBeenCalledTimes(1)
    expect(storedMarker()).toMatchObject({ accountId: 'user-self' })
  })

  it('kill switch: {disabled:true} response still writes the marker — fleet goes quiet', async () => {
    h.callRemote.mockResolvedValue({ disabled: true })

    await maybeSendFirstSeenPing(NOW)

    expect(storedMarker()).toMatchObject({ accountId: 'user-self', disabled: true })

    // And the marker throttles exactly like a success.
    vi.clearAllMocks()
    await maybeSendFirstSeenPing(NOW + 1000)
    expect(h.callRemote).not.toHaveBeenCalled()
  })

  it('never throws into the banner path, even when storage itself throws', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage dead')
    })
    try {
      await expect(maybeSendFirstSeenPing(NOW)).resolves.toBeUndefined()
    } finally {
      spy.mockRestore()
    }
  })
})
