import { describe, it, expect, beforeEach } from 'vitest'
import {
  isPrefetchDone,
  markPrefetchDone,
  tryClaimLock,
  releaseLock,
  type KvStore,
} from './throttle'

const BUILD = 'abc1234'

function memoryStore(): KvStore & { keys: () => string[] } {
  const map = new Map<string, string>()
  return {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    keys: () => [...map.keys()],
  }
}

describe('prefetch done-key', () => {
  let store: ReturnType<typeof memoryStore>
  beforeEach(() => {
    store = memoryStore()
  })

  it('is not done before any mark', () => {
    expect(isPrefetchDone(BUILD, store)).toBe(false)
  })

  it('is done after marking, scoped to the build key', () => {
    markPrefetchDone(BUILD, store)
    expect(isPrefetchDone(BUILD, store)).toBe(true)
    expect(isPrefetchDone('next-deploy', store)).toBe(false)
  })

  it('only ever writes zenuml:prefetch:* keys', () => {
    markPrefetchDone(BUILD, store)
    tryClaimLock(1000, store)
    releaseLock(store)
    expect(store.keys().every((k) => k.startsWith('zenuml:prefetch:'))).toBe(true)
  })

  it('treats a throwing store as done (never prefetch untracked)', () => {
    const broken: KvStore = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(isPrefetchDone(BUILD, broken)).toBe(true)
    expect(() => markPrefetchDone(BUILD, broken)).not.toThrow()
    expect(tryClaimLock(1000, broken)).toBe(false)
    expect(() => releaseLock(broken)).not.toThrow()
  })
})

describe('prefetch lock', () => {
  let store: ReturnType<typeof memoryStore>
  beforeEach(() => {
    store = memoryStore()
  })

  it('grants a free lock and denies a held one', () => {
    expect(tryClaimLock(1000, store)).toBe(true)
    expect(tryClaimLock(2000, store)).toBe(false)
  })

  it('treats a stale lock (>60s) as free', () => {
    expect(tryClaimLock(1000, store)).toBe(true)
    expect(tryClaimLock(1000 + 60_001, store)).toBe(true)
  })

  it('can be re-claimed after release', () => {
    expect(tryClaimLock(1000, store)).toBe(true)
    releaseLock(store)
    expect(tryClaimLock(2000, store)).toBe(true)
  })

  it('treats a malformed lock value as free', () => {
    store.setItem('zenuml:prefetch:lock', 'not-a-number')
    expect(tryClaimLock(1000, store)).toBe(true)
  })
})
