import { FeatureFlags, type FeatureFlagUser, type ForgeFeatureFlagConfig } from '@forge/bridge'
import forgeGlobal, { getContext } from '@/model/globals/forgeGlobal'

const AI_TITLE_FLAG_ID = 'ai-title-enabled'
const AI_CHAT_FLAG_ID = 'ai-chat-enabled'
const AI_REPAIR_FLAG_ID = 'ai-repair-enabled'
const AGENT_LINK_FLAG_ID = 'agent-link-enabled'
const ARCHITECTURE_TOKENS_FLAG_ID = 'architecture-tokens-enabled'

let featureFlags: FeatureFlags | undefined
let initializePromise: Promise<FeatureFlags> | undefined

function standaloneAiTitleEnabled(): boolean {
  try {
    return localStorage.getItem('mockAiTitleEnabled') !== 'false'
  } catch {
    return true
  }
}

function standaloneAiRepairEnabled(): boolean {
  try {
    return localStorage.getItem('mockAiRepairEnabled') !== 'false'
  } catch {
    return true
  }
}

function standaloneAiChatEnabled(): boolean {
  try {
    return localStorage.getItem('mockAiChatEnabled') !== 'false'
  } catch {
    return false
  }
}

// Unlike ai-title/ai-repair (which default ON in standalone dev for
// convenience), Live Agent Link defaults OFF everywhere — the Forge Console
// flag defaults false via checkFlag's second arg, and standalone dev only
// opts IN via an explicit localStorage override. This mirrors the "defaults
// OFF, cannot affect existing users" requirement for the flag's prod rollout.
function standaloneAgentLinkEnabled(): boolean {
  try {
    return localStorage.getItem('mockAgentLinkEnabled') === 'true'
  } catch {
    return false
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

export async function isAiTitleEnabled(): Promise<boolean> {
  if (!forgeGlobal.isForge) return standaloneAiTitleEnabled()

  const client = await getFeatureFlagsClient()
  return client.checkFlag(AI_TITLE_FLAG_ID, false)
}

export async function isAiRepairEnabled(): Promise<boolean> {
  if (!forgeGlobal.isForge) return standaloneAiRepairEnabled()

  const client = await getFeatureFlagsClient()
  return client.checkFlag(AI_REPAIR_FLAG_ID, false)
}

/**
 * AI Chat is independently gated from AI Title and AI Repair. A Forge flag
 * lookup failure must keep Chat disabled so callers can preserve the existing
 * editor and AI Repair behavior.
 */
export async function isAiChatEnabled(): Promise<boolean> {
  if (!forgeGlobal.isForge) return standaloneAiChatEnabled()

  try {
    const client = await getFeatureFlagsClient()
    return await client.checkFlag(AI_CHAT_FLAG_ID, false)
  } catch (error) {
    console.error('Failed to load AI Chat feature flag:', error)
    return false
  }
}

// Live Agent Link (docs/superpowers/specs/2026-07-08-live-agent-link-design.md)
// master switch for mounting the Connect UI into the macro host — the flag
// gates everything, so when it resolves false the macro renders exactly as
// it does today.
export async function isAgentLinkEnabled(): Promise<boolean> {
  if (!forgeGlobal.isForge) return standaloneAgentLinkEnabled()

  const client = await getFeatureFlagsClient()
  return client.checkFlag(AGENT_LINK_FLAG_ID, false)
}

/** Viewer "also appears in other diagrams" context. Pilot-tenant rule in prod; default false. */
export async function isArchitectureTokensEnabled(): Promise<boolean> {
  if (!forgeGlobal.isForge) return false

  const client = await getFeatureFlagsClient()
  return client.checkFlag(ARCHITECTURE_TOKENS_FLAG_ID, false)
}

export function resetAiTitleFlagForTests(): void {
  featureFlags?.shutdown()
  featureFlags = undefined
  initializePromise = undefined
}
