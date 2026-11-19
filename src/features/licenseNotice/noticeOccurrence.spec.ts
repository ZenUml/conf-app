import { describe, expect, it } from 'vitest'
import { licenseNoticeOccurrence } from './noticeOccurrence'
import { LICENSE_NOTICE_REPEAT_SAMPLE_RATE } from '@/utils/analytics/eventSampling'

function memoryStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
  }
}

const NOV_16 = () => Date.parse('2026-11-16T02:00:00Z')
const NOV_17 = () => Date.parse('2026-11-17T00:00:01Z')
const scope = { clientDomain: 'example', macroKey: 'cc-1', surface: 'viewer' as const }
const keep = () => 0
const drop = () => 0.5

// 2026-11-16: one enforced Lite site sent 15,440 license_notice_shown and
// 15,710 license_notice_evaluated over only 4,905 user x macro keys. The first
// notice per browser x macro x UTC day is the evidence that a viewer saw it;
// repeats are sampled like macro_viewed repeats.
describe('licenseNoticeOccurrence', () => {
  it('always sends the first notice of a macro today, marked first', () => {
    expect(licenseNoticeOccurrence('shown', scope, { storage: memoryStorage(), clock: NOV_16, random: drop }))
      .toEqual({ view_of_day: 'first' })
  })

  it('drops a repeat outside the sample', () => {
    const storage = memoryStorage()
    licenseNoticeOccurrence('shown', scope, { storage, clock: NOV_16, random: drop })
    expect(licenseNoticeOccurrence('shown', scope, { storage, clock: NOV_16, random: drop })).toBeNull()
  })

  it('sends a sampled repeat with its sample_rate', () => {
    const storage = memoryStorage()
    licenseNoticeOccurrence('shown', scope, { storage, clock: NOV_16, random: drop })
    expect(licenseNoticeOccurrence('shown', scope, { storage, clock: NOV_16, random: keep }))
      .toEqual({ view_of_day: 'repeat', sample_rate: LICENSE_NOTICE_REPEAT_SAMPLE_RATE })
  })

  it('counts shown and evaluated separately, and starts over the next UTC day', () => {
    const storage = memoryStorage()
    licenseNoticeOccurrence('shown', scope, { storage, clock: NOV_16, random: drop })
    expect(licenseNoticeOccurrence('evaluated', scope, { storage, clock: NOV_16, random: drop }))
      .toEqual({ view_of_day: 'first' })
    expect(licenseNoticeOccurrence('shown', scope, { storage, clock: NOV_17, random: drop }))
      .toEqual({ view_of_day: 'first' })
  })

  it('does not share its record with macro_viewed', () => {
    const storage = memoryStorage()
    licenseNoticeOccurrence('shown', scope, { storage, clock: NOV_16, random: drop })
    expect(storage.getItem('zenuml.macroViewedToday:example')).toBeNull()
  })

  it('sends at full rate, unmarked, when it cannot tell first from repeat', () => {
    expect(licenseNoticeOccurrence('shown', { ...scope, macroKey: null }, { storage: memoryStorage(), clock: NOV_16, random: drop }))
      .toEqual({})
    expect(licenseNoticeOccurrence('shown', scope, { storage: null, clock: NOV_16, random: drop })).toEqual({})
  })
})
