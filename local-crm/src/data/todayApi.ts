import type { ExtensionsLoadState } from './extensionsApi'
import type { Dataset } from './types'

export type TodayGrantMode = 'loading' | 'live' | 'partial' | 'unavailable'

/**
 * Today shares the Extensions read. Grant KV is the authoritative stream;
 * Marketplace, JSM, and D1 add context but are not required to retain it.
 */
export function todayGrantMode(load: ExtensionsLoadState): TodayGrantMode {
  if (load.state === 'loading') return 'loading'
  if (
    load.state === 'error'
    || load.sources?.space_license_kv.state !== 'ok'
  ) return 'unavailable'
  return load.state
}

/**
 * Compose Today's intentionally mixed dataset. Only grant-backed fields cross
 * the live boundary. Every registration/contact/workflow field stays on the
 * sanitized baseline, while an unavailable KV read yields no grant claims.
 */
export function buildTodayDataset(
  base: Dataset,
  extensions: Dataset,
  load: ExtensionsLoadState
): Dataset {
  const mode = todayGrantMode(load)
  if (mode === 'live' || mode === 'partial') {
    return {
      ...base,
      today: extensions.today,
      grants: extensions.grants,
      jsm: extensions.jsm,
      jsmUnconfirmedAuthor: extensions.jsmUnconfirmedAuthor,
      origins: extensions.origins
    }
  }

  return {
    ...base,
    grants: [],
    jsm: {},
    jsmUnconfirmedAuthor: [],
    origins: []
  }
}
