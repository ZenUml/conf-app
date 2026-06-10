import { describe, it, expect, vi } from 'vitest'
import { getPrefetchFlags, mapEnvironment, MASTER_FLAG, BANNER_FLAG } from './flags'

function fakeClient(flags: Record<string, boolean>) {
  return {
    initialize: vi.fn(async () => undefined),
    checkFlag: vi.fn((name: string, defaultValue = false) => flags[name] ?? defaultValue),
    shutdown: vi.fn(),
  }
}

const FORGE_CONTEXT = {
  cloudId: 'example-cloud-id',
  accountId: 'account-123',
  environmentType: 'PRODUCTION',
}

describe('mapEnvironment', () => {
  it.each([
    ['DEVELOPMENT', 'development'],
    ['STAGING', 'staging'],
    ['PRODUCTION', 'production'],
    ['weird', 'production'],
    [undefined, 'production'],
  ])('maps %s → %s', (input, expected) => {
    expect(mapEnvironment(input)).toBe(expected)
  })
})

describe('getPrefetchFlags (Forge feature flags)', () => {
  it('initializes with installContext + lowercased environment and evaluates both flags', async () => {
    const client = fakeClient({ [MASTER_FLAG]: true, [BANNER_FLAG]: true })
    const result = await getPrefetchFlags({
      createClient: async () => client,
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ macroHost: true, bannerHost: true })
    // Custom UI context has no installContext field — the install ARI is
    // constructed from cloudId and passed as an attribute (client-SDK docs).
    expect(client.initialize).toHaveBeenCalledWith(
      {
        attributes: { installContext: 'ari:cloud:confluence::site/example-cloud-id' },
        identifiers: { accountId: 'account-123' },
      },
      { environment: 'production' },
    )
    expect(client.checkFlag).toHaveBeenCalledWith(MASTER_FLAG, false)
    expect(client.checkFlag).toHaveBeenCalledWith(BANNER_FLAG, false)
    expect(client.shutdown).toHaveBeenCalledOnce()
  })

  it('banner host requires the master flag too', async () => {
    const result = await getPrefetchFlags({
      createClient: async () => fakeClient({ [MASTER_FLAG]: false, [BANNER_FLAG]: true }),
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ macroHost: false, bannerHost: false })
  })

  it('master on without banner flag enables only the macro host', async () => {
    const result = await getPrefetchFlags({
      createClient: async () => fakeClient({ [MASTER_FLAG]: true }),
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ macroHost: true, bannerHost: false })
  })

  it('fails closed without a cloudId (standalone/local dev)', async () => {
    const createClient = vi.fn()
    const result = await getPrefetchFlags({
      createClient,
      getForgeContext: async () => ({ environmentType: 'DEVELOPMENT' }),
    })
    expect(result).toEqual({ macroHost: false, bannerHost: false })
    expect(createClient).not.toHaveBeenCalled() // no SDK init without a target
  })

  it('fails closed when initialize throws, still shutting the client down', async () => {
    const client = fakeClient({})
    client.initialize = vi.fn(async () => {
      throw new Error('bridge unavailable')
    })
    const result = await getPrefetchFlags({
      createClient: async () => client,
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ macroHost: false, bannerHost: false })
    expect(client.shutdown).toHaveBeenCalledOnce()
  })

  it('fails closed when the context resolve throws', async () => {
    const result = await getPrefetchFlags({
      createClient: async () => fakeClient({ [MASTER_FLAG]: true }),
      getForgeContext: async () => {
        throw new Error('no bridge')
      },
    })
    expect(result).toEqual({ macroHost: false, bannerHost: false })
  })
})
