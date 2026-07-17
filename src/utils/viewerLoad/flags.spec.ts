import { describe, it, expect, vi } from 'vitest'
import { getViewerLoadFlags, ADF_DEFER_FLAG } from './flags'
import { mapEnvironment } from '@/utils/prefetch/flags'

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

describe('getViewerLoadFlags (Forge feature flags)', () => {
  it('initializes with installContext + lowercased environment and evaluates the flag', async () => {
    const client = fakeClient({ [ADF_DEFER_FLAG]: true })
    const result = await getViewerLoadFlags({
      createClient: async () => client,
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ adfScanDeferred: true })
    // Custom UI context has no installContext field — the install ARI is
    // constructed from cloudId and passed as an attribute (client-SDK docs).
    expect(client.initialize).toHaveBeenCalledWith(
      {
        attributes: { installContext: 'ari:cloud:confluence::site/example-cloud-id' },
        identifiers: { accountId: 'account-123' },
      },
      { environment: 'production' },
    )
    expect(client.checkFlag).toHaveBeenCalledWith(ADF_DEFER_FLAG, false)
    expect(client.shutdown).toHaveBeenCalledOnce()
  })

  it('flag off returns adfScanDeferred: false', async () => {
    const result = await getViewerLoadFlags({
      createClient: async () => fakeClient({ [ADF_DEFER_FLAG]: false }),
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ adfScanDeferred: false })
  })

  it('fails closed without a cloudId (standalone/local dev)', async () => {
    const createClient = vi.fn()
    const result = await getViewerLoadFlags({
      createClient,
      getForgeContext: async () => ({ environmentType: 'DEVELOPMENT' }),
    })
    expect(result).toEqual({ adfScanDeferred: false })
    expect(createClient).not.toHaveBeenCalled() // no SDK init without a target
  })

  it('fails closed when initialize throws, still shutting the client down', async () => {
    const client = fakeClient({})
    client.initialize = vi.fn(async () => {
      throw new Error('bridge unavailable')
    })
    const result = await getViewerLoadFlags({
      createClient: async () => client,
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ adfScanDeferred: false })
    expect(client.shutdown).toHaveBeenCalledOnce()
  })

  it('fails closed when the context resolve throws', async () => {
    const result = await getViewerLoadFlags({
      createClient: async () => fakeClient({ [ADF_DEFER_FLAG]: true }),
      getForgeContext: async () => {
        throw new Error('no bridge')
      },
    })
    expect(result).toEqual({ adfScanDeferred: false })
  })

  it('reuses mapEnvironment from prefetch/flags (environment mapping passed through)', () => {
    expect(mapEnvironment('STAGING')).toBe('staging')
    expect(mapEnvironment(undefined)).toBe('production')
  })
})
