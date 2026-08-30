import { describe, expect, it } from 'vitest'
import { placeholderDataset } from './placeholder'
import { resolveDataset, shouldLoadLiveSources } from './datasetSelection'

describe('local dataset selection', () => {
  it('fails closed when the real local dataset is absent', () => {
    expect(resolveDataset({ override: null, fixtureRequested: false, mode: 'development' })).toEqual({
      state: 'unavailable',
      data: null,
      reason: 'Local dataset is unavailable. Generate src/data/local/dataset.ts or explicitly select the fixture in development or test.'
    })
  })

  it('does not let a placeholder-shaped local override bypass fixture labelling', () => {
    expect(resolveDataset({ override: placeholderDataset, fixtureRequested: false, mode: 'development' })).toMatchObject({
      state: 'unavailable',
      data: null
    })
  })

  it.each(['development', 'test'])('allows an explicitly selected fixture in %s mode', mode => {
    expect(resolveDataset({ override: null, fixtureRequested: true, mode })).toEqual({
      state: 'fixture',
      data: placeholderDataset,
      reason: null
    })
  })

  it('rejects fixture selection in production mode', () => {
    expect(resolveDataset({ override: null, fixtureRequested: true, mode: 'production' })).toEqual({
      state: 'unavailable',
      data: null,
      reason: 'Fixture data is restricted to explicit development or test use.'
    })
  })

  it('never starts live source loaders for an explicitly selected fixture', () => {
    const selection = resolveDataset({ override: null, fixtureRequested: true, mode: 'development' })
    expect(shouldLoadLiveSources(selection)).toBe(false)
  })
})
