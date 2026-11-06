import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  EXPORT_EVENT_SAMPLE_RATES,
  decideExportSample,
  exportSampleRateFor,
} from '@/lib/exportSampling.js'

describe('exportSampling', () => {
  // Base-rate assertions below describe the rates before the event budget began.
  beforeEach(() => vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-15T00:00:00Z')))
  afterEach(() => vi.mocked(Date.now).mockRestore())

  it('reduces requested/succeeded from 5% to 0.5% from October 2026 onward', () => {
    const october = Date.parse('2026-10-12T00:00:00Z')
    const before = Date.parse('2026-09-30T23:59:59.999Z')
    const after = Date.parse('2026-11-01T00:00:00Z')
    for (const name of ['macro_export_requested', 'macro_export_succeeded']) {
      expect(exportSampleRateFor(name, before)).toBe(0.05)
      expect(exportSampleRateFor(name, october)).toBe(0.005)
      expect(exportSampleRateFor(name, after)).toBe(0.005)
      expect(decideExportSample(name, () => 0.004, october)).toEqual({ sample_rate: 0.005 })
      expect(decideExportSample(name, () => 0.005, october)).toBeNull()
    }
    expect(exportSampleRateFor('macro_export_failed', october)).toBe(0.1)
    expect(exportSampleRateFor('unknown_other_product_event', october)).toBe(1)
  })

  it('samples the PNG lifecycle diagnostics at 10% without a further budget cut', () => {
    const november = Date.parse('2026-11-15T00:00:00Z')
    for (const name of ['png_export_state_changed', 'png_export_state_persistence_skipped']) {
      expect(exportSampleRateFor(name, november)).toBe(0.1)
      expect(decideExportSample(name, () => 0.09, november)).toEqual({ sample_rate: 0.1 })
    }
    expect(exportSampleRateFor('png_export_state_persistence_failed', november)).toBe(1)
  })
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
