/**
 * First-vs-repeat sampling for the license notice events.
 *
 * Every macro iframe that shows the notice sends `license_notice_evaluated`
 * (outcome `shown`) and `license_notice_shown`. On 2026-11-16 one enforced
 * Lite site sent 15,440 + 15,710 of them, over only 4,905 user x macro x UTC
 * day keys: readers reopen the same pages all day. The first notice per
 * browser x macro x UTC day answers "did this viewer see the notice on this
 * diagram today", so it is always sent; repeats are sampled at
 * LICENSE_NOTICE_REPEAT_SAMPLE_RATE and carry `sample_rate`, like macro_viewed
 * repeats (utils/analytics/macroViewOfDay.ts, whose record this reuses under
 * its own storage key).
 *
 * Cannot remember (no storage, no macro id): send at full rate, unmarked.
 */
import forgeGlobal from '@/model/globals/forgeGlobal'
import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'
import { resolveEffectiveCustomContentId } from '@/utils/effectiveCustomContentId'
import { LICENSE_NOTICE_REPEAT_SAMPLE_RATE } from '@/utils/analytics/eventSampling'
import { classifyMacroView, defaultStorage, type MacroViewScope } from '@/utils/analytics/macroViewOfDay'

const KEY_PREFIX = 'zenuml.licenseNoticeToday'

export type LicenseNoticeEventKind = 'shown' | 'evaluated'

export interface LicenseNoticeOccurrenceProps {
  view_of_day?: 'first' | 'repeat'
  sample_rate?: number
}

interface Deps {
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null
  clock?: () => number
  random?: () => number
}

/** Props to send with the event, or null when this repeat is sampled out. */
export function licenseNoticeOccurrence(
  kind: LicenseNoticeEventKind,
  scope: MacroViewScope,
  deps: Deps = {},
): LicenseNoticeOccurrenceProps | null {
  const storage = deps.storage === undefined ? defaultStorage() : deps.storage
  const viewOfDay = classifyMacroView(
    { ...scope, surface: `${kind}:${scope.surface}` },
    storage,
    deps.clock ?? Date.now,
    KEY_PREFIX,
  )
  if (viewOfDay === null) return {}
  if (viewOfDay === 'first') return { view_of_day: 'first' }
  if ((deps.random ?? Math.random)() >= LICENSE_NOTICE_REPEAT_SAMPLE_RATE) return null
  return { view_of_day: 'repeat', sample_rate: LICENSE_NOTICE_REPEAT_SAMPLE_RATE }
}

/** The same decision for the macro this iframe renders. */
export function currentLicenseNoticeOccurrence(
  kind: LicenseNoticeEventKind,
  surface: string,
): LicenseNoticeOccurrenceProps | null {
  let scope: MacroViewScope
  try {
    const ctx = forgeGlobal?.forgeContext
    scope = {
      clientDomain: getClientDomain(),
      macroKey: resolveEffectiveCustomContentId(ctx) ?? ctx?.localId,
      surface,
    }
  } catch {
    return {}
  }
  return licenseNoticeOccurrence(kind, scope)
}
