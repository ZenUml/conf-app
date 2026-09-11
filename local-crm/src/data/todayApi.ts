import type { ExtensionsLoadState } from './extensionsApi'
import type { LifecycleLoadState } from './lifecycleApi'
import type { Dataset } from './types'
import { human } from '@/lib/format'

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
  load: ExtensionsLoadState,
  lifecycle?: LifecycleLoadState
): Dataset {
  const mode = todayGrantMode(load)
  const registrations = lifecycle?.state === 'live' ? [] : base.registrations
  const liveIngest = lifecycle?.data
    ? {
        ...base.ingest,
        rowsRead: lifecycle.data.source.marketplaceRows,
        rowsTotal: lifecycle.data.source.marketplaceRows,
        contactsWritten: lifecycle.data.summary.contacts,
        runAt: new Date(lifecycle.data.generatedAt).toISOString(),
        // Keep the ingest date in the CRM's strict `03 Sep` vocabulary.
        // `toLocaleDateString('en-GB')` emits `03 Sept`, which `iso()` rejects.
        runDay: human(lifecycle.data.generatedAt.slice(0, 10)),
        localSchema: 'lifecycle.sqlite',
        productionSchema: 'not used by Local CRM'
      }
    : base.ingest
  if (mode === 'live' || mode === 'partial') {
    return {
      ...base,
      registrations,
      ingest: liveIngest,
      today: extensions.today,
      grants: extensions.grants,
      jsm: extensions.jsm,
      jsmUnconfirmedAuthor: extensions.jsmUnconfirmedAuthor,
      origins: extensions.origins
    }
  }

  return {
    ...base,
    registrations,
    ingest: liveIngest,
    grants: [],
    jsm: {},
    jsmUnconfirmedAuthor: [],
    origins: []
  }
}
