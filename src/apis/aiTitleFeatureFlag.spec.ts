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
  checkError: undefined as Error | undefined,
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
      checkFlag: vi.fn(() => {
        if (featureFlagsState.checkError) throw featureFlagsState.checkError
        return featureFlagsState.nextValue
      }),
      shutdown: vi.fn(),
    }
    featureFlagsState.instances.push(instance)
    return instance
  }),
}))

import {
  isAiChatEnabled,
  isAiTitleEnabled,
  isAiRepairEnabled,
  isAgentLinkEnabled,
  isArchitectureTokensEnabled,
  resetAiTitleFlagForTests,
} from './aiTitleFeatureFlag'

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
    featureFlagsState.checkError = undefined
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
    featureFlagsState.checkError = undefined
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

describe('isAiChatEnabled', () => {
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
    featureFlagsState.checkError = undefined
    localStorage.clear()
  })

  it('checks the independent Forge ai-chat-enabled flag with a false default', async () => {
    await expect(isAiChatEnabled()).resolves.toBe(true)

    const instance = featureFlagsState.instances[0]
    expect(instance.checkFlag).toHaveBeenCalledWith('ai-chat-enabled', false)
  })

  it('reuses the feature flag client shared with the existing AI flags', async () => {
    await isAiTitleEnabled()
    await isAiRepairEnabled()
    await isAiChatEnabled()

    expect(featureFlagsState.instances).toHaveLength(1)
    expect(featureFlagsState.instances[0].initialize).toHaveBeenCalledTimes(1)
    expect(featureFlagsState.instances[0].checkFlag).toHaveBeenCalledTimes(3)
  })

  it('defaults to enabled in standalone local dev unless localStorage disables it', async () => {
    forgeState.isForge = false
    await expect(isAiChatEnabled()).resolves.toBe(true)

    localStorage.setItem('mockAiChatEnabled', 'false')
    await expect(isAiChatEnabled()).resolves.toBe(false)
    expect(featureFlagsState.instances).toHaveLength(0)
  })

  it('returns disabled when Forge flag initialization fails and allows a later retry', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    featureFlagsState.initializeError = new Error('temporary bridge failure')
    await expect(isAiChatEnabled()).resolves.toBe(false)

    featureFlagsState.initializeError = undefined
    await expect(isAiChatEnabled()).resolves.toBe(true)
    expect(featureFlagsState.instances).toHaveLength(2)
    expect(consoleError).toHaveBeenCalledOnce()
    consoleError.mockRestore()
  })

  it('returns disabled when the Forge flag check fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    featureFlagsState.checkError = new Error('flag service unavailable')

    await expect(isAiChatEnabled()).resolves.toBe(false)

    expect(consoleError).toHaveBeenCalledWith(
      'Failed to load AI Chat feature flag:',
      featureFlagsState.checkError,
    )
    consoleError.mockRestore()
  })
})

describe('isAgentLinkEnabled', () => {
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
    featureFlagsState.checkError = undefined
    localStorage.clear()
  })

  it('checks the Forge agent-link-enabled flag with a false default', async () => {
    // nextValue is true on the mock client, but the real-world default
    // (Console flag not yet created / not targeted) is what checkFlag's
    // second arg encodes — assert we ask for `false`, not that we get it.
    await expect(isAgentLinkEnabled()).resolves.toBe(true)

    const instance = featureFlagsState.instances[0]
    expect(instance.checkFlag).toHaveBeenCalledWith('agent-link-enabled', false)
  })

  it('resolves false when the Console flag evaluates false (the shipped default)', async () => {
    featureFlagsState.nextValue = false
    await expect(isAgentLinkEnabled()).resolves.toBe(false)
  })

  it('reuses the initialized Forge client shared with ai-title-enabled / ai-repair-enabled', async () => {
    await isAgentLinkEnabled()
    await isAgentLinkEnabled()

    expect(featureFlagsState.instances).toHaveLength(1)
    expect(featureFlagsState.instances[0].initialize).toHaveBeenCalledTimes(1)
    expect(featureFlagsState.instances[0].checkFlag).toHaveBeenCalledTimes(2)
  })

  it('defaults to DISABLED in standalone local dev unless localStorage explicitly opts in', async () => {
    forgeState.isForge = false
    await expect(isAgentLinkEnabled()).resolves.toBe(false)

    localStorage.setItem('mockAgentLinkEnabled', 'true')
    await expect(isAgentLinkEnabled()).resolves.toBe(true)
    expect(featureFlagsState.instances).toHaveLength(0)
  })
})

describe('isArchitectureTokensEnabled', () => {
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
    featureFlagsState.checkError = undefined
  })

  it('checks the Forge architecture-tokens-enabled flag with a false default', async () => {
    await expect(isArchitectureTokensEnabled()).resolves.toBe(true)

    const instance = featureFlagsState.instances[0]
    expect(instance.checkFlag).toHaveBeenCalledWith('architecture-tokens-enabled', false)
  })
})
