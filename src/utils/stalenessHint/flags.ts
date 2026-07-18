import { getContext } from '@/model/globals/forgeGlobal'
import { mapEnvironment } from '@/utils/prefetch/flags'

export const STALENESS_HINT_FLAG = 'editor-staleness-hint-enabled'

type FeatureFlagEnvironment = 'development' | 'staging' | 'production'

interface FlagClient {
  initialize(
    user: {
      attributes?: Record<string, string | number>
      identifiers?: { installContext?: string; accountId?: string }
    },
    config?: { environment: FeatureFlagEnvironment },
  ): Promise<void>
  checkFlag(flagName: string, defaultValue?: boolean): boolean
  shutdown(): void
}

async function defaultCreateClient(): Promise<FlagClient> {
  const { FeatureFlags } = await import('@forge/bridge')
  return new FeatureFlags()
}

/** Fail-closed: standalone env, missing cloudId, missing flag, any error => off. */
export async function isStalenessHintEnabled(deps?: {
  createClient?: () => Promise<FlagClient>
  getForgeContext?: () => Promise<{ cloudId?: string; accountId?: string; environmentType?: string } | undefined>
}): Promise<boolean> {
  let client: FlagClient | undefined
  try {
    const context = await (deps?.getForgeContext ?? getContext)()
    const cloudId = context?.cloudId
    if (!cloudId) return false
    client = await (deps?.createClient ?? defaultCreateClient)()
    await client.initialize(
      {
        attributes: { installContext: `ari:cloud:confluence::site/${cloudId}` },
        identifiers: { accountId: context?.accountId },
      },
      { environment: mapEnvironment(context?.environmentType) },
    )
    return client.checkFlag(STALENESS_HINT_FLAG, false)
  } catch (e) {
    console.debug('[staleness-hint] flag off: evaluation failed', e)
    return false
  } finally {
    try {
      client?.shutdown()
    } catch {
      // best-effort cleanup
    }
  }
}
