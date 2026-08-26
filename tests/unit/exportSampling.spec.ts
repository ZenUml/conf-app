import { describe, expect, it } from 'vitest'
import {
  EXPORT_EVENT_SAMPLE_RATES,
  decideExportSample,
  exportSampleRateFor,
} from '@/lib/exportSampling.js'

describe('exportSampling', () => {
  it('samples the three export events and leaves everything else alone', () => {
    expect(exportSampleRateFor('macro_export_requested')).toBe(0.05)
    expect(exportSampleRateFor('macro_export_succeeded')).toBe(0.05)
    expect(exportSampleRateFor('macro_export_failed')).toBe(0.1)
    expect(exportSampleRateFor('macro_viewed')).toBe(1)
  })

  // The failure breakdown is split across several failure_reason buckets, so it
  // keeps twice the rate of the success paths.
  it('keeps the failure event at a higher rate than the success paths', () => {
    expect(EXPORT_EVENT_SAMPLE_RATES.macro_export_failed).toBeGreaterThan(
      EXPORT_EVENT_SAMPLE_RATES.macro_export_succeeded,
    )
  })

  it('emits an unsampled event with no added properties', () => {
    expect(decideExportSample('macro_viewed', () => 0.99)).toEqual({})
  })

  // The boundary matters: `random() >= rate` drops, so a draw exactly at the
  // rate must NOT be kept, or the effective rate exceeds the configured one.
  it('keeps a draw below the rate and drops one at or above it', () => {
    expect(decideExportSample('macro_export_requested', () => 0.049)).toEqual({ sample_rate: 0.05 })
    expect(decideExportSample('macro_export_requested', () => 0.05)).toBeNull()
    expect(decideExportSample('macro_export_requested', () => 0.5)).toBeNull()
  })

  it('stamps the kept event so a count extrapolates as count / sample_rate', () => {
    expect(decideExportSample('macro_export_failed', () => 0)).toEqual({ sample_rate: 0.1 })
  })
})
