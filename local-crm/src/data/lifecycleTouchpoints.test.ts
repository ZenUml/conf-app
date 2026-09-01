import { describe, expect, it } from 'vitest'
import { lifecycleTouchpointSummary, localObservationLabel } from './lifecycleTouchpoints'
import type { LifecycleTouchpointRecord } from './lifecycleContract'

const lapsed: LifecycleTouchpointRecord = {
  id: 7,
  app: 'lite',
  kind: 'lapsed',
  step: 'lapsed',
  createdAt: '2026-08-30T10:00:00.000Z',
  meta: { reason: 'absent-or-inactive' }
}

describe('local lifecycle touchpoint presentation', () => {
  it('keeps an empty local observation history explicitly empty', () => {
    expect(lifecycleTouchpointSummary([])).toEqual({ total: 0, byKind: {}, byStep: {} })
  })

  it('reports a lapsed row as a local lifecycle observation, not message activity', () => {
    expect(lifecycleTouchpointSummary([lapsed])).toEqual({ total: 1, byKind: { lapsed: 1 }, byStep: { lapsed: 1 } })
    expect(localObservationLabel(lapsed)).toBe('Local lifecycle observation · lapsed')
  })

  it('never labels a local row as sent, delivered, customer contact, or engagement', () => {
    const text = localObservationLabel(lapsed).toLowerCase()
    expect(text).not.toMatch(/sent|deliver|customer contact|engagement/)
  })
})
