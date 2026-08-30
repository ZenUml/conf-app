import type { Dataset } from './types'
import { placeholderDataset } from './placeholder'

export type DatasetSelection =
  | { state: 'local'; data: Dataset; reason: null }
  | { state: 'fixture'; data: Dataset; reason: null }
  | { state: 'unavailable'; data: null; reason: string }

export function resolveDataset(options: {
  override: Dataset | null
  fixtureRequested: boolean
  mode: string
}): DatasetSelection {
  if (options.override && !options.override.placeholder) {
    return { state: 'local', data: options.override, reason: null }
  }
  if (options.override?.placeholder && !options.fixtureRequested) {
    return {
      state: 'unavailable',
      data: null,
      reason: 'A placeholder-shaped local override cannot be treated as real data. Explicitly select the fixture in development or test.'
    }
  }
  if (options.fixtureRequested) {
    if (options.mode === 'development' || options.mode === 'test') {
      return { state: 'fixture', data: placeholderDataset, reason: null }
    }
    return {
      state: 'unavailable',
      data: null,
      reason: 'Fixture data is restricted to explicit development or test use.'
    }
  }
  return {
    state: 'unavailable',
    data: null,
    reason: 'Local dataset is unavailable. Generate src/data/local/dataset.ts or explicitly select the fixture in development or test.'
  }
}

export function shouldLoadLiveSources(selection: DatasetSelection): boolean {
  return selection.state === 'local'
}
