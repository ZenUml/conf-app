import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  readRetryMarker,
  startRetryMarker,
  settleRetryMarker,
  clearRetryMarker,
  RETRY_MARKER_TTL_MS,
} from '@/utils/loadFailedRetry'

describe('loadFailedRetry marker', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns null when no retry is in flight', () => {
    expect(readRetryMarker('macro-1')).toBeNull()
  })

  it('records the first retry as attempt 1 and leaves an outcome owed', () => {
    expect(startRetryMarker('macro-1', 1000)).toBe(1)
    expect(readRetryMarker('macro-1', 2000)).toEqual({
      attempt: 1,
      startedAt: 1000,
      pending: true,
    })
  })

  // A user who retries a failure that already failed a retry is a different
  // case from a first retry, and the counter has to survive the page reload
  // that sits between the two clicks.
  it('numbers a second retry of the same macro as attempt 2', () => {
    startRetryMarker('macro-1', 1000)
    settleRetryMarker('macro-1', 2000)
    expect(startRetryMarker('macro-1', 3000)).toBe(2)
  })

  // Two macros render in the SAME iframe origin and therefore share one
  // sessionStorage — a marker keyed on anything less specific than the macro
  // would attribute macro A's retry to macro B's reload.
  it('keeps one macro’s marker out of another macro’s read', () => {
    startRetryMarker('macro-1', 1000)
    expect(readRetryMarker('macro-2', 2000)).toBeNull()
  })

  // The viewer iframe remounts without a retry (scroll back into view,
  // fullscreen open). Only the first resolution after a click may be reported.
  it('stops owing an outcome once the retry is settled', () => {
    startRetryMarker('macro-1', 1000)
    settleRetryMarker('macro-1', 2000)
    expect(readRetryMarker('macro-1', 2000)?.pending).toBe(false)
  })

  // A user who retries and then leaves the page must not have a later,
  // unrelated render attributed to that retry.
  it('drops a marker older than the TTL and removes it', () => {
    startRetryMarker('macro-1', 1000)
    expect(readRetryMarker('macro-1', 1000 + RETRY_MARKER_TTL_MS + 1)).toBeNull()
    expect(sessionStorage.length).toBe(0)
  })

  it('clears a marker', () => {
    startRetryMarker('macro-1', 1000)
    clearRetryMarker('macro-1')
    expect(readRetryMarker('macro-1', 2000)).toBeNull()
  })

  it('returns null for a malformed marker instead of throwing', () => {
    sessionStorage.setItem('zenumlLoadFailedRetry:macro-1', 'not json')
    expect(readRetryMarker('macro-1')).toBeNull()
  })

  // Forge renders the viewer in a sandboxed iframe; storage access can throw
  // outright (blocked site data). Telemetry must never break the panel.
  it('survives a sessionStorage that throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    expect(() => startRetryMarker('macro-1')).not.toThrow()
    expect(readRetryMarker('macro-1')).toBeNull()
  })
})
