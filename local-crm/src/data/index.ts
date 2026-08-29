import type { Dataset } from './types'
import { placeholderDataset } from './placeholder'

/**
 * Resolve the dataset the console runs on.
 *
 * `src/data/local/dataset.ts` is git-excluded. When it exists it must default-export
 * a `Dataset` and it wins; otherwise the shipped placeholder rows are used. The
 * glob is lazy about absence — Vite resolves it to `{}` when nothing matches, so
 * no import fails and no fallback is masking an error.
 *
 * See README.md § Real data for how to produce that file.
 */
const overrides = import.meta.glob<{ default: Dataset }>('./local/dataset.ts', {
  eager: true
})

const override = Object.values(overrides)[0]?.default

export const dataset: Dataset = override ?? placeholderDataset

export * from './types'
