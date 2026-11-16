import { describe, expect, it } from 'vitest'
import { parseSiteEnforcement, siteEnforcementNotice } from './siteEnforcementNotice'

const enforcement = (over: Record<string, unknown> = {}, effects: Record<string, boolean> = {}) => ({
  stage: 'watermark', effectiveAt: '2026-12-08T00:00:00Z', count: 2282, limit: 100,
  effects: { datedBanner: true, watermark: true, blockCreate: false, requestEdit: false, ...effects },
  ...over,
})

describe('siteEnforcementNotice', () => {
  it.each([
    ['lite + watermark effect', 'lite', enforcement(), { basis: 'site_policy_limit_reached', count: 2282, limit: 100, stage: 'watermark' }],
    ['lite + block_create stage keeps the watermark', 'lite', enforcement({ stage: 'block_create' }, { blockCreate: true }), { basis: 'site_policy_limit_reached', count: 2282, limit: 100, stage: 'block_create' }],
    ['lite + notice stage (watermark off)', 'lite', enforcement({ stage: 'notice' }, { watermark: false }), null],
    ['lite + enforcement absent', 'lite', null, null],
    ['lite + enforcement undefined', 'lite', undefined, null],
    ['full product', 'full', enforcement(), null],
    ['diagramly product', 'diagramly', enforcement(), null],
    ['unknown product', undefined, enforcement(), null],
    ['malformed: unknown stage', 'lite', enforcement({ stage: 'later' }), null],
    ['malformed: count not a number', 'lite', enforcement({ count: '2282' }), null],
    ['malformed: count NaN', 'lite', enforcement({ count: NaN }), null],
    ['malformed: limit missing', 'lite', enforcement({ limit: undefined }), null],
    ['malformed: effects missing', 'lite', enforcement({ effects: undefined }), null],
    ['malformed: watermark is the string "true"', 'lite', { ...enforcement(), effects: { watermark: 'true' } }, null],
    ['malformed: a string', 'lite', 'on', null],
  ])('%s', (_name, productType, input, expected) => {
    expect(siteEnforcementNotice({ productType: productType as string | undefined, enforcement: input as any })).toEqual(expected)
  })
})

describe('parseSiteEnforcement', () => {
  it('keeps a well-formed object and drops unknown extras', () => {
    expect(parseSiteEnforcement({ ...enforcement(), extra: 1 })).toEqual(enforcement())
  })
  it.each([[null], [undefined], [42], [{}], [enforcement({ stage: 'x' })]])('rejects %j', (v) => {
    expect(parseSiteEnforcement(v)).toBeNull()
  })
})

describe('requestEdit / meterEdit transition (the two deploys are independent)', () => {
  const base = { stage: 'block_edit', effectiveAt: '2026-12-08T00:00:00Z', count: 2282, limit: 100 }
  it('old server -> new client: only meterEdit is sent; the object and its watermark survive', () => {
    const parsed = parseSiteEnforcement({ ...base, effects: { datedBanner: true, watermark: true, blockCreate: true, meterEdit: true } })
    expect(parsed?.effects).toMatchObject({ watermark: true, requestEdit: true })
    expect(siteEnforcementNotice({ productType: 'lite', enforcement: parsed })).not.toBeNull()
  })
  it('new server -> new client: requestEdit alone is enough', () => {
    const parsed = parseSiteEnforcement({ ...base, effects: { datedBanner: true, watermark: true, blockCreate: true, requestEdit: true } })
    expect(parsed?.effects.requestEdit).toBe(true)
  })
  it('new server -> old client: both names are sent, so the old parser still finds the one it reads', () => {
    const wire = { ...base, effects: { datedBanner: true, watermark: true, blockCreate: true, requestEdit: true, meterEdit: true } }
    // The old client required finite count/limit, a known stage and an effects object, and read meterEdit === true.
    expect(wire.effects.meterEdit).toBe(true)
    expect(parseSiteEnforcement(wire)?.effects.requestEdit).toBe(true)
  })
  it('neither name: false, and the object still survives', () => {
    const parsed = parseSiteEnforcement({ ...base, stage: 'watermark', effects: { datedBanner: true, watermark: true, blockCreate: false } })
    expect(parsed?.effects.requestEdit).toBe(false)
    expect(parsed?.effects.watermark).toBe(true)
  })
})
