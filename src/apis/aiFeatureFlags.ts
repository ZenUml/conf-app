import { FeatureFlags, type FeatureFlagUser, type ForgeFeatureFlagConfig } from '@forge/bridge'
import forgeGlobal, { getContext } from '@/model/globals/forgeGlobal'

const AI_TITLE_FLAG_ID = 'ai-title-enabled'
const AI_CHAT_FLAG_ID = 'ai-chat-enabled'
const AI_REPAIR_FLAG_ID = 'ai-repair-enabled'

let featureFlags: FeatureFlags | undefined
let initializePromise: Promise<FeatureFlags> | undefined

function standaloneFeatureEnabled(storageKey: string): boolean {
  try {
    return localStorage.getItem(storageKey) !== 'false'
  } catch {
    return true
  }
}

function environmentFromContext(ctx: any): ForgeFeatureFlagConfig['environment'] {
  const environment = String(ctx?.environmentType || 'development').toLowerCase()
  if (environment === 'staging' || environment === 'production') return environment
  return 'development'
}

async function getFeatureFlagsClient(): Promise<FeatureFlags> {
  if (featureFlags) return featureFlags
  if (!initializePromise) {
    initializePromise = (async () => {
      const ctx = await getContext()
      const client = new FeatureFlags()
      const installContext = `ari:cloud:confluence::site/${ctx.cloudId}`
      const user: FeatureFlagUser = {
        identifiers: {
          installContext,
          accountId: ctx.accountId,
        },
        attributes: {
          installContext,
          accountId: ctx.accountId,
        },
      }
      await client.initialize(user, { environment: environmentFromContext(ctx) })
      featureFlags = client
      return client
    })()
  }

  try {
    return await initializePromise
  } catch (error) {
    initializePromise = undefined
    throw error
  }
}

async function isAiFeatureEnabled(flagId: string, standaloneStorageKey: string): Promise<boolean> {
  if (!forgeGlobal.isForge) return standaloneFeatureEnabled(standaloneStorageKey)

  const client = await getFeatureFlagsClient()
  return client.checkFlag(flagId, false)
}

export async function isAiTitleEnabled(): Promise<boolean> {
  return isAiFeatureEnabled(AI_TITLE_FLAG_ID, 'mockAiTitleEnabled')
}

export async function isAiChatEnabled(): Promise<boolean> {
  return isAiFeatureEnabled(AI_CHAT_FLAG_ID, 'mockAiChatEnabled')
}

export async function isAiRepairEnabled(): Promise<boolean> {
  return isAiFeatureEnabled(AI_REPAIR_FLAG_ID, 'mockAiRepairEnabled')
}

export function resetAiTitleFlagForTests(): void {
  featureFlags?.shutdown()
  featureFlags = undefined
  initializePromise = undefined
}
