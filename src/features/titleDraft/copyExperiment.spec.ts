import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ enabled: vi.fn() }))
vi.mock('@/utils/featureConstants', () => ({ isTitleDraftCopyExperimentEnabled: m.enabled }))
import { createTitleDraftCopyExposure, readTitleDraftCopyExposure, titleDraftCopyProps, titleDraftCopyVariant } from './copyExperiment'

beforeEach(() => { m.enabled.mockReturnValue(true) })
afterEach(() => vi.restoreAllMocks())

describe('title draft copy experiment', () => {
  it('assigns only from account ID, without storage, time or random sampling', () => {
    const first = titleDraftCopyVariant('account-1')
    vi.spyOn(Math, 'random').mockImplementation(() => { throw new Error('no random cohort draw') })
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('no storage') })
    vi.spyOn(Date, 'now').mockReturnValue(123)
    expect(titleDraftCopyVariant('account-1')).toBe(first)
    expect(titleDraftCopyVariant('account-1')).toBe(first)
  })

  it('keeps the version-one cohort vectors stable', () => {
    expect(titleDraftCopyVariant('acc-1')).toBe('A')
    expect(titleDraftCopyVariant('account-1')).toBe('B')
  })

  it('splits a broad synthetic account sample roughly evenly', () => {
    const countA = Array.from({ length: 10000 }, (_, i) => titleDraftCopyVariant(`account-${i}`)).filter(v => v === 'A').length
    expect(countA).toBeGreaterThan(4700)
    expect(countA).toBeLessThan(5300)
  })

  it('creates a fresh immutable exposure per show while retaining the account cohort', () => {
    const first = createTitleDraftCopyExposure('account-1')!
    const second = createTitleDraftCopyExposure('account-1')!
    expect(first.variant).toBe(second.variant)
    expect(first.exposureId).not.toBe(second.exposureId)
    expect(Object.isFrozen(first)).toBe(true)
    expect(readTitleDraftCopyExposure(first)).toEqual(first)
  })

  it('omits attribution when the build switch is off', () => {
    m.enabled.mockReturnValue(false)
    expect(createTitleDraftCopyExposure('account-1')).toBeUndefined()
    expect(titleDraftCopyProps()).toEqual({})
  })

  it.each(['', '   ', undefined, null, 42])('does not assign missing/invalid account %s', (account) => {
    expect(createTitleDraftCopyExposure(account as string)).toBeUndefined()
  })

  it.each([
    undefined, null, {}, [],
    { experimentId: 'another-experiment' },
    { experimentVersion: 2 },
    { variant: 'C' },
    { exposureId: '' },
    { exposureId: '<private text>' },
  ])('rejects legacy or malformed exposure data %j', (invalid) => {
    const valid = createTitleDraftCopyExposure('account-1')!
    const value = invalid && !Array.isArray(invalid) && Object.keys(invalid).length ? { ...valid, ...invalid } : invalid
    expect(readTitleDraftCopyExposure(value)).toBeUndefined()
  })

  it('copies only bounded experiment fields from a valid context', () => {
    const exposure = createTitleDraftCopyExposure('account-1')!
    expect(titleDraftCopyProps(readTitleDraftCopyExposure({ ...exposure, title: 'private title', accountId: 'private account' }))).toEqual({
      title_draft_experiment_id: 'title-draft-offer-copy', title_draft_experiment_version: 1,
      title_draft_variant: exposure.variant, title_draft_exposure_id: exposure.exposureId,
    })
  })
})
