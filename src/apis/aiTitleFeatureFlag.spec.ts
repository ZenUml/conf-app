import { beforeEach, describe, expect, it, vi } from 'vitest'

const forgeState = vi.hoisted(() => ({
  isForge: true,
  context: {
    cloudId: 'cloud-1',
    accountId: 'account-1',
    environmentType: 'STAGING',
  },
}))

const featureFlagsState = vi.hoisted(() => ({
  instances: [] as any[],
  nextValue: true,
  initializeError: undefined as Error | undefined,
}))

vi.mock('@/model/globals/forgeGlobal', () => ({
  default: forgeState,
  getContext: vi.fn(async () => forgeState.context),
}))

vi.mock('@forge/bridge', () => ({
  FeatureFlags: vi.fn().mockImplementation(() => {
    const instance = {
      initialize: vi.fn(async () => {
        if (featureFlagsState.initializeError) throw featureFlagsState.initializeError
      }),
      checkFlag: vi.fn(() => featureFlagsState.nextValue),
      shutdown: vi.fn(),
    }
    featureFlagsState.instances.push(instance)
    return instance
  }),
}))

import { isAiTitleEnabled, isAiRepairEnabled, resetAiTitleFlagForTests } from './aiTitleFeatureFlag'

describe('isAiTitleEnabled', () => {
  beforeEach(() => {
    resetAiTitleFlagForTests()
    forgeState.isForge = true
    forgeState.context = {
      cloudId: 'cloud-1',
      accountId: 'account-1',
      environmentType: 'STAGING',
    }
    featureFlagsState.instances = []
    featureFlagsState.nextValue = true
    featureFlagsState.initializeError = undefined
    localStorage.clear()
  })

  it('checks the Forge ai-title-enabled flag using site, account, and environment context', async () => {
    await expect(isAiTitleEnabled()).resolves.toBe(true)

    const instance = featureFlagsState.instances[0]
    expect(instance.initialize).toHaveBeenCalledWith(
      {
        identifiers: {
          installContext: 'ari:cloud:confluence::site/cloud-1',
          accountId: 'account-1',
        },
        attributes: {
          installContext: 'ari:cloud:confluence::site/cloud-1',
          accountId: 'account-1',
        },
      },
      { environment: 'staging' },
    )
    expect(instance.checkFlag).toHaveBeenCalledWith('ai-title-enabled', false)
  })

  it('reuses the initialized Forge client between checks', async () => {
    await isAiTitleEnabled()
    await isAiTitleEnabled()

    expect(featureFlagsState.instances).toHaveLength(1)
    expect(featureFlagsState.instances[0].initialize).toHaveBeenCalledTimes(1)
    expect(featureFlagsState.instances[0].checkFlag).toHaveBeenCalledTimes(2)
  })

  it('defaults to enabled in standalone local dev unless localStorage disables it', async () => {
    forgeState.isForge = false
    await expect(isAiTitleEnabled()).resolves.toBe(true)

    localStorage.setItem('mockAiTitleEnabled', 'false')
    await expect(isAiTitleEnabled()).resolves.toBe(false)
    expect(featureFlagsState.instances).toHaveLength(0)
  })

  it('retries Forge initialization after a transient SDK failure', async () => {
    featureFlagsState.initializeError = new Error('temporary bridge failure')
    await expect(isAiTitleEnabled()).rejects.toThrow('temporary bridge failure')

    featureFlagsState.initializeError = undefined
    await expect(isAiTitleEnabled()).resolves.toBe(true)
    expect(featureFlagsState.instances).toHaveLength(2)
  })
})

describe('isAiRepairEnabled', () => {
  beforeEach(() => {
    resetAiTitleFlagForTests()
    forgeState.isForge = true
    forgeState.context = {
      cloudId: 'cloud-1',
      accountId: 'account-1',
      environmentType: 'STAGING',
    }
    featureFlagsState.instances = []
    featureFlagsState.nextValue = true
    featureFlagsState.initializeError = undefined
    localStorage.clear()
  })

  it('checks the Forge ai-repair-enabled flag using site, account, and environment context', async () => {
    await expect(isAiRepairEnabled()).resolves.toBe(true)

    const instance = featureFlagsState.instances[0]
    expect(instance.checkFlag).toHaveBeenCalledWith('ai-repair-enabled', false)
  })

  it('reuses the initialized Forge client shared with ai-title-enabled', async () => {
    await isAiRepairEnabled()
    await isAiRepairEnabled()

    expect(featureFlagsState.instances).toHaveLength(1)
    expect(featureFlagsState.instances[0].initialize).toHaveBeenCalledTimes(1)
    expect(featureFlagsState.instances[0].checkFlag).toHaveBeenCalledTimes(2)
  })

  it('defaults to enabled in standalone local dev unless localStorage disables it', async () => {
    forgeState.isForge = false
    await expect(isAiRepairEnabled()).resolves.toBe(true)

    localStorage.setItem('mockAiRepairEnabled', 'false')
    await expect(isAiRepairEnabled()).resolves.toBe(false)
    expect(featureFlagsState.instances).toHaveLength(0)
  })
})
