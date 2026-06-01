import { FeatureFlags, type FeatureFlagUser, type ForgeFeatureFlagConfig } from '@forge/bridge'
import forgeGlobal, { getContext } from '@/model/globals/forgeGlobal'

const AI_TITLE_FLAG_ID = 'ai-title-enabled'

let featureFlags: FeatureFlags | undefined
let initializePromise: Promise<FeatureFlags> | undefined

function standaloneAiTitleEnabled(): boolean {
  try {
    return localStorage.getItem('mockAiTitleEnabled') !== 'false'
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
      const user: FeatureFlagUser = {
        identifiers: {
          installContext: `ari:cloud:confluence::site/${ctx.cloudId}`,
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

export async function isAiTitleEnabled(): Promise<boolean> {
  if (!forgeGlobal.isForge) return standaloneAiTitleEnabled()

  const client = await getFeatureFlagsClient()
  return client.checkFlag(AI_TITLE_FLAG_ID, false)
}

export function resetAiTitleFlagForTests(): void {
  featureFlags?.shutdown()
  featureFlags = undefined
  initializePromise = undefined
}
