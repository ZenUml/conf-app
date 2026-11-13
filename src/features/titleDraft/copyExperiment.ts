import type { TitleDraftCopyExperimentId, TitleDraftCopyExperimentVersion, TitleDraftCopyVariant } from '@/utils/analytics/catalog'
import { isTitleDraftCopyExperimentEnabled } from '@/utils/featureConstants'
import uuidv4 from '@/utils/uuid'

export const TITLE_DRAFT_COPY_EXPERIMENT_ID: TitleDraftCopyExperimentId = 'title-draft-offer-copy'
export const TITLE_DRAFT_COPY_EXPERIMENT_VERSION: TitleDraftCopyExperimentVersion = 1

/** Production native flags and the Storybook fixture share these exact strings. */
export const TITLE_DRAFT_OFFER_COPY = {
  A: {
    title: 'A diagram for this page is ready',
    description: 'ZenUML sketched it from the page title. Nothing changes until you add it.',
    primary: 'See diagram',
    secondary: 'Not now',
  },
  B: {
    title: 'Help readers understand this page',
    description: 'Preview a draft diagram based on the page title. Your page stays unchanged until you add it.',
    primary: 'Preview diagram',
    secondary: 'Not now',
  },
} as const

export interface TitleDraftCopyExposure {
  readonly experimentId: TitleDraftCopyExperimentId
  readonly experimentVersion: TitleDraftCopyExperimentVersion
  readonly variant: TitleDraftCopyVariant
  readonly exposureId: string
}

/**
 * Version-salted FNV-1a with a final avalanche, then one 50/50 bit. Account ID
 * is the only identity input: no tenant, page, storage, clock or random draw.
 * Keep this algorithm and salt stable for v1 so refreshes and browsers agree.
 */
export function titleDraftCopyVariant(accountId: string): TitleDraftCopyVariant | undefined {
  if (typeof accountId !== 'string' || !accountId.trim()) return undefined
  const key = `${TITLE_DRAFT_COPY_EXPERIMENT_ID}:v${TITLE_DRAFT_COPY_EXPERIMENT_VERSION}\0${accountId}`
  let hash = 0x811c9dc5
  for (let i = 0; i < key.length; i++) hash = Math.imul(hash ^ key.charCodeAt(i), 0x01000193)
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  hash ^= hash >>> 16
  return (hash & 1) === 0 ? 'A' : 'B'
}

/** Called once, only when an eligible native flag is about to be shown. */
export function createTitleDraftCopyExposure(accountId: string): TitleDraftCopyExposure | undefined {
  if (!isTitleDraftCopyExperimentEnabled()) return undefined
  const variant = titleDraftCopyVariant(accountId)
  if (!variant) return undefined
  return Object.freeze({
    experimentId: TITLE_DRAFT_COPY_EXPERIMENT_ID,
    experimentVersion: TITLE_DRAFT_COPY_EXPERIMENT_VERSION,
    variant,
    exposureId: uuidv4(),
  })
}

/** Legacy or malformed modal/storage payloads never acquire an assignment. */
export function readTitleDraftCopyExposure(value: unknown): TitleDraftCopyExposure | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Partial<TitleDraftCopyExposure>
  if (v.experimentId !== TITLE_DRAFT_COPY_EXPERIMENT_ID
    || v.experimentVersion !== TITLE_DRAFT_COPY_EXPERIMENT_VERSION
    || (v.variant !== 'A' && v.variant !== 'B')
    || typeof v.exposureId !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v.exposureId)) return undefined
  return Object.freeze({ experimentId: v.experimentId, experimentVersion: v.experimentVersion, variant: v.variant, exposureId: v.exposureId })
}

export function titleDraftCopyProps(exposure?: TitleDraftCopyExposure) {
  return exposure ? {
    title_draft_experiment_id: exposure.experimentId,
    title_draft_experiment_version: exposure.experimentVersion,
    title_draft_variant: exposure.variant,
    title_draft_exposure_id: exposure.exposureId,
  } : {}
}
