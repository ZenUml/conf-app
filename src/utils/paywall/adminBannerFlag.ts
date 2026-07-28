import { getContext } from '@/model/globals/forgeGlobal'
import { mapEnvironment } from '@/utils/forgeFlagEnvironment'

/**
 * Kill switch for the Phase 5b space-admin banner audience.
 *
 * The banner itself is old; what is new is showing it to space admins who have
 * authored nothing. That materially widens the audience on the 19 CSS-enrolled
 * tenants — the author gate reached 358 unique users in 60d, against a 10%-sampled
 * floor of 5,021 observed space admins — so it ships behind a flag and is inert
 * until switched on per environment.
 *
 * Deliberately NOT consulted on the hot path: `decidePageBanner()` stays
 * synchronous and this is awaited only once it has already decided the banner
 * would show *and* that it would show solely because of admin status — i.e. on
 * impressions that did not exist before Phase 5b. Loads that were already
 * eligible pay nothing and behave exactly as before.
 */
export const PAYWALL_ADMIN_BANNER_FLAG = 'paywall-admin-banner-enabled'

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

/** Fail-closed: standalone env, missing cloudId, missing flag, any error => off,
 * which means the banner reverts to its pre-Phase-5b author-only behaviour. */
export async function isAdminBannerEnabled(deps?: {
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
    return client.checkFlag(PAYWALL_ADMIN_BANNER_FLAG, false)
  } catch (e) {
    console.debug('[paywall-admin-banner] flag off: evaluation failed', e)
    return false
  } finally {
    try {
      client?.shutdown()
    } catch {
      // best-effort cleanup
    }
  }
}
