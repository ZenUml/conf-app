import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { markerKey, readJsonMarker, removeMarker, writeJsonMarker } from './marker'

const asNumber = (raw: unknown): number | null => (typeof raw === 'number' ? raw : null)

describe('markerKey', () => {
  it('joins the prefix and encoded parts with colons', () => {
    expect(markerKey('p', 'a:b c/é', 'x')).toBe('p:a%3Ab%20c%2F%C3%A9:x')
    expect(markerKey('p')).toBe('p')
  })

  it('falls back to "unknown" for empty, null and undefined parts', () => {
    expect(markerKey('p', '', null, undefined)).toBe('p:unknown:unknown:unknown')
  })
})

describe('JSON markers', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('round-trips a value', () => {
    expect(writeJsonMarker('k', { n: 1 })).toBe(true)
    expect(localStorage.getItem('k')).toBe('{"n":1}')
    expect(readJsonMarker('k', (raw) => raw as { n: number })).toEqual({ n: 1 })
  })

  it('returns null for a missing key without calling parse', () => {
    const parse = vi.fn()
    expect(readJsonMarker('missing', parse)).toBeNull()
    expect(parse).not.toHaveBeenCalled()
  })

  it('returns null for invalid JSON', () => {
    localStorage.setItem('k', '{oops')
    expect(readJsonMarker('k', asNumber)).toBeNull()
  })

  it('returns null when parse rejects the value', () => {
    localStorage.setItem('k', '"text"')
    expect(readJsonMarker('k', asNumber)).toBeNull()
  })

  it('returns null when parse itself throws', () => {
    localStorage.setItem('k', 'null')
    expect(readJsonMarker('k', (raw) => (raw as any).x)).toBeNull()
  })

  it('removeMarker deletes the key', () => {
    localStorage.setItem('k', '1')
    removeMarker('k')
    expect(localStorage.getItem('k')).toBeNull()
  })

  it('never throws when getItem, setItem or removeItem throw', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('denied')
    })
    expect(readJsonMarker('k', asNumber)).toBeNull()
    expect(writeJsonMarker('k', 1)).toBe(false)
    expect(() => removeMarker('k')).not.toThrow()
  })

  it('reports a write failure to the optional onError callback', () => {
    const err = new Error('QuotaExceeded')
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw err
    })
    const onError = vi.fn()
    expect(writeJsonMarker('k', 1, onError)).toBe(false)
    expect(onError).toHaveBeenCalledWith(err)
  })

  it('never throws when window.localStorage itself throws on access', () => {
    const spy = vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('SecurityError')
    })
    expect(readJsonMarker('k', asNumber)).toBeNull()
    expect(writeJsonMarker('k', 1)).toBe(false)
    expect(() => removeMarker('k')).not.toThrow()
    spy.mockRestore()
  })

  it('treats an unserialisable value as a failed write', () => {
    const circular: any = {}
    circular.self = circular
    expect(writeJsonMarker('k', circular)).toBe(false)
  })
})
