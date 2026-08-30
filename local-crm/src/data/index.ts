import type { Dataset } from './types'
import { resolveDataset } from './datasetSelection'
import { setBareDateYear } from '@/lib/format'

/**
 * Resolve the dataset the console runs on.
 *
 * `src/data/local/dataset.ts` is git-excluded. When it exists it must default-export
 * a `Dataset` and it wins. Without it the app fails closed. The synthetic fixture
 * is available only when VITE_LOCAL_CRM_DATASET=fixture is explicitly selected
 * in development or test mode.
 *
 * See README.md § Real data for how to produce that file.
 */
const overrides = import.meta.glob<{ default: Dataset }>('./local/dataset.ts', {
  eager: true
})

const override = Object.values(overrides)[0]?.default

export const datasetSelection = resolveDataset({
  override: override ?? null,
  fixtureRequested: import.meta.env.VITE_LOCAL_CRM_DATASET === 'fixture',
  mode: import.meta.env.MODE
})

// Bare '27 Aug' strings belong to the dataset's own year, not to a literal in
// the formatter. Binding them here keeps `iso()` and `human()` a lossless pair
// when the dataset moves to another year.
if (datasetSelection.data) setBareDateYear(datasetSelection.data.today.slice(0, 4))

export * from './types'
