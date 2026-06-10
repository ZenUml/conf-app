import { describe, it, expect } from 'vitest'
import { evaluateFlag, getPrefetchFlags, MASTER_FLAG, BANNER_FLAG } from './flags'
import type { FeatureFlags } from '@/types/feature-flags'
import type { KvStore } from './throttle'

function flagsJson(overrides: {
  masterEnabled?: boolean
  masterDefault?: boolean
  masterInclude?: string[]
  masterExclude?: string[]
  bannerEnabled?: boolean
  bannerDefault?: boolean
}): FeatureFlags {
  return {
    metadata: { version: '1.0.0', lastUpdated: '2026-06-10T00:00:00Z' },
    flags: {
      [MASTER_FLAG]: {
        name: MASTER_FLAG,
        description: '',
        enabled: overrides.masterEnabled ?? true,
        rules: {
          domains: { include: overrides.masterInclude ?? [], exclude: overrides.masterExclude ?? [] },
          default: overrides.masterDefault ?? false,
        },
      },
      [BANNER_FLAG]: {
        name: BANNER_FLAG,
        description: '',
        enabled: overrides.bannerEnabled ?? true,
        rules: {
          domains: { include: [], exclude: [] },
          default: overrides.bannerDefault ?? false,
        },
      },
    },
  } as unknown as FeatureFlags
}

function memoryStore(): KvStore {
  const map = new Map<string, string>()
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  }
}

describe('evaluateFlag', () => {
  it('is off when the flag is missing or disabled', () => {
    expect(evaluateFlag(null, MASTER_FLAG, 'acme')).toBe(false)
    expect(evaluateFlag(flagsJson({ masterEnabled: false, masterDefault: true }), MASTER_FLAG, 'acme')).toBe(false)
  })

  it('honors default when no domain rule matches', () => {
    expect(evaluateFlag(flagsJson({ masterDefault: true }), MASTER_FLAG, 'acme')).toBe(true)
    expect(evaluateFlag(flagsJson({ masterDefault: false }), MASTER_FLAG, 'acme')).toBe(false)
  })

  it('include overrides default-off; exclude overrides include and default-on', () => {
    expect(evaluateFlag(flagsJson({ masterInclude: ['acme'] }), MASTER_FLAG, 'acme')).toBe(true)
    expect(
      evaluateFlag(flagsJson({ masterDefault: true, masterInclude: ['acme'], masterExclude: ['acme'] }), MASTER_FLAG, 'acme'),
    ).toBe(false)
  })

  it('falls back to default when the domain is unknown', () => {
    expect(evaluateFlag(flagsJson({ masterInclude: ['acme'] }), MASTER_FLAG, undefined)).toBe(false)
  })
})

describe('getPrefetchFlags', () => {
  it('banner host requires the master flag too', async () => {
    const result = await getPrefetchFlags({
      store: memoryStore(),
      clientDomain: 'acme',
      fetchFlags: async () => flagsJson({ masterDefault: false, bannerDefault: true }),
    })
    expect(result).toEqual({ macroHost: false, bannerHost: false })

    const both = await getPrefetchFlags({
      store: memoryStore(),
      clientDomain: 'acme',
      fetchFlags: async () => flagsJson({ masterDefault: true, bannerDefault: true }),
    })
    expect(both).toEqual({ macroHost: true, bannerHost: true })
  })

  it('fails closed when the fetch throws', async () => {
    const result = await getPrefetchFlags({
      store: memoryStore(),
      clientDomain: 'acme',
      fetchFlags: async () => {
        throw new Error('offline')
      },
    })
    expect(result).toEqual({ macroHost: false, bannerHost: false })
  })

  it('memoizes the result and skips refetch inside the TTL', async () => {
    const store = memoryStore()
    let calls = 0
    const fetchFlags = async () => {
      calls++
      return flagsJson({ masterDefault: true })
    }
    const first = await getPrefetchFlags({ store, clientDomain: 'acme', fetchFlags, now: 1000 })
    const second = await getPrefetchFlags({ store, clientDomain: 'acme', fetchFlags, now: 2000 })
    expect(first.macroHost).toBe(true)
    expect(second.macroHost).toBe(true)
    expect(calls).toBe(1)
  })

  it('refetches after the TTL expires', async () => {
    const store = memoryStore()
    let calls = 0
    const fetchFlags = async () => {
      calls++
      return flagsJson({ masterDefault: calls > 1 })
    }
    await getPrefetchFlags({ store, clientDomain: 'acme', fetchFlags, now: 0 })
    const later = await getPrefetchFlags({ store, clientDomain: 'acme', fetchFlags, now: 6 * 60 * 60 * 1000 + 1 })
    expect(calls).toBe(2)
    expect(later.macroHost).toBe(true)
  })
})
