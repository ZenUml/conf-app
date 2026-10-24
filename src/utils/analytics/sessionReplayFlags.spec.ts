import { describe, it, expect, vi } from 'vitest'
import {
  getSessionReplayConfig,
  mapEnvironment,
  FULL_FLAG,
  SAMPLED_FLAG,
} from './sessionReplayFlags'

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

describe('getSessionReplayConfig (Forge feature flags)', () => {
  it('initializes with installContext + lowercased environment', async () => {
    const client = fakeClient({ [SAMPLED_FLAG]: true })
    await getSessionReplayConfig({
      createClient: async () => client,
      getForgeContext: async () => FORGE_CONTEXT,
    })
    // Custom UI context has no installContext field — the install ARI is
    // constructed from cloudId and passed as an attribute (client-SDK docs).
    expect(client.initialize).toHaveBeenCalledWith(
      {
        attributes: { installContext: 'ari:cloud:confluence::site/example-cloud-id' },
        identifiers: { accountId: 'account-123' },
      },
      { environment: 'production' },
    )
    expect(client.shutdown).toHaveBeenCalledOnce()
  })

  it('targeted full capture wins → 100% even when the general flag is off', async () => {
    const client = fakeClient({ [FULL_FLAG]: true, [SAMPLED_FLAG]: false })
    const result = await getSessionReplayConfig({
      createClient: async () => client,
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ percent: 100, source: 'targeted' })
    // Short-circuits before consulting the general rollout flag.
    expect(client.checkFlag).toHaveBeenCalledWith(FULL_FLAG, false)
    expect(client.checkFlag).not.toHaveBeenCalledWith(SAMPLED_FLAG, false)
  })

  it('general rollout cohort → 100% (the rollout % is the live rate)', async () => {
    const result = await getSessionReplayConfig({
      createClient: async () => fakeClient({ [FULL_FLAG]: false, [SAMPLED_FLAG]: true }),
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ percent: 100, source: 'sampled' })
  })

  it('neither flag set → off (0%)', async () => {
    const result = await getSessionReplayConfig({
      createClient: async () => fakeClient({ [FULL_FLAG]: false, [SAMPLED_FLAG]: false }),
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ percent: 0, source: 'off' })
  })

  it('fails closed (0%) when there is no cloudId — standalone / non-Forge', async () => {
    const client = fakeClient({ [SAMPLED_FLAG]: true })
    const result = await getSessionReplayConfig({
      createClient: async () => client,
      getForgeContext: async () => ({ accountId: 'a', environmentType: 'PRODUCTION' }),
    })
    expect(result).toEqual({ percent: 0, source: 'off' })
    // Never even constructs the client without an install to target.
    expect(client.initialize).not.toHaveBeenCalled()
  })

  it('fails closed (0%) when flag evaluation throws', async () => {
    const result = await getSessionReplayConfig({
      createClient: async () => {
        throw new Error('bridge unavailable')
      },
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ percent: 0, source: 'off' })
  })

  it('still shuts the client down when checkFlag throws', async () => {
    const client = {
      initialize: vi.fn(async () => undefined),
      checkFlag: vi.fn(() => {
        throw new Error('boom')
      }),
      shutdown: vi.fn(),
    }
    const result = await getSessionReplayConfig({
      createClient: async () => client,
      getForgeContext: async () => FORGE_CONTEXT,
    })
    expect(result).toEqual({ percent: 0, source: 'off' })
    expect(client.shutdown).toHaveBeenCalledOnce()
  })
})
