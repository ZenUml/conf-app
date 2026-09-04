import { describe, expect, it } from 'vitest'
import { crmReducer, INITIAL_CRM_STATE } from './crm'

describe('CRM session state', () => {
  it('resets only the stream filter when navigating', () => {
    const state = { ...INITIAL_CRM_STATE, filter: 'expired' as const, query: 'tenant-a' }
    expect(crmReducer(state, { type: 'go', screen: 'sites' })).toMatchObject({
      screen: 'sites',
      filter: 'all',
      query: 'tenant-a'
    })
  })

  it('opens every drawer on Evidence and clears pending confirmation', () => {
    const state = { ...INITIAL_CRM_STATE, tab: 'audit' as const, confirming: 'e1:revoke' }
    expect(crmReducer(state, { type: 'open', id: 'e2' })).toMatchObject({
      selected: 'e2',
      tab: 'evidence',
      confirming: null
    })
  })

  it('requires the inline confirmation pass before stamping an action', () => {
    const first = crmReducer(INITIAL_CRM_STATE, {
      type: 'run',
      key: 'e2:revoke',
      needsConfirm: true,
      stamp: 'unused'
    })
    expect(first.confirming).toBe('e2:revoke')
    expect(first.done).toEqual({})

    const confirmed = crmReducer(first, {
      type: 'run',
      key: 'e2:revoke',
      needsConfirm: false,
      stamp: '29 Aug 2026 12:34 · operator'
    })
    expect(confirmed.confirming).toBeNull()
    expect(confirmed.done['e2:revoke']).toBe('29 Aug 2026 12:34 · operator')
  })
})
