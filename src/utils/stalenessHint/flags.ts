import { FORGE_FLAGS } from '@/utils/featureFlags/registry'
import { checkForgeFlag, type ForgeFlagDeps } from '@/utils/featureFlags/forgeFlagClient'

export const STALENESS_HINT_FLAG = FORGE_FLAGS.stalenessHint

/** Fail-closed: standalone env, missing cloudId, missing flag, any error => off. */
export async function isStalenessHintEnabled(deps?: ForgeFlagDeps): Promise<boolean> {
  return checkForgeFlag('[staleness-hint]', STALENESS_HINT_FLAG, deps)
}
