import { FULLSCREEN_RECOVERY_SCENARIOS } from '../../../shared/fullscreenRecovery'
import type { RecoveryScenario } from '../../../shared/fullscreenRecovery'

export interface FullscreenSource {
  scenarios: RecoveryScenario[]
  pageId?: string
}

/** Forge global-page location is supplied in extension.location, not the iframe URL. */
export function parseFullscreenSource(location: unknown): FullscreenSource | null {
  if (typeof location !== 'string') return null
  let url: URL
  try { url = new URL(location) } catch { return null }
  if (url.searchParams.get('source') !== 'fullscreen_recovery') return null
  const allowed = new Set<string>(FULLSCREEN_RECOVERY_SCENARIOS)
  const scenarios = [...new Set((url.searchParams.get('scenes') || '').split(',').filter(code => allowed.has(code)))] as RecoveryScenario[]
  const pageId = url.searchParams.get('page_id')
  return { scenarios, ...(pageId && /^\d+$/.test(pageId) ? { pageId } : {}) }
}

export function diagramReturnPath(source: FullscreenSource): string | null {
  return source.pageId ? `/wiki/pages/viewpage.action?pageId=${source.pageId}` : null
}
