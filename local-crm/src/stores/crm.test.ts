import { describe, expect, it } from 'vitest'
import { crmReducer, INITIAL_CRM_STATE } from './crm'
import type { QueueRow } from '@/lib/queue'

const REQUEST_ROW: QueueRow = {
  id: 'request:ZEN-1234',
  lifecycle: 'extension',
  reason: 'waiting_on_support',
  date: '2026-08-30',
  score: 0,
  title: 'example / ENGINEERING',
  detail: 'waiting for support',
  evidence: '41 macros · limit 50',
  ticketKey: 'ZEN-1234',
  ticketUrl: 'https://example.invalid/browse/ZEN-1234',
  cloudId: 'cloud-id',
  spaceKey: 'ENGINEERING',
  requester: 'requester@example.invalid',
  comments: {
    state: 'known',
    publicCommentCount: 2,
    requesterCommentCount: 1,
    lastCommentAt: '2026-08-30T10:00:00.000Z',
    lastCommentAuthor: 'Support',
    lastCommentAuthorship: 'non_requester',
    reason: null
  },
  command: '/extend-space-license --cloud-id cloud-id --space ENGINEERING --days 7',
  eventId: null
}

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

    const repeated = crmReducer(first, {
      type: 'run',
      key: 'e2:revoke',
      needsConfirm: false,
      stamp: '29 Aug 2026 12:34 · operator'
    })
    expect(repeated.confirming).toBe('e2:revoke')
    expect(repeated.done).toEqual({})
  })

  it('opens a request drawer without inventing an event case, then clears it', () => {
    const opened = crmReducer(
      { ...INITIAL_CRM_STATE, selected: 'grant:existing:created' },
      { type: 'openQueue', row: REQUEST_ROW }
    )
    expect(opened).toMatchObject({ selected: null, selectedQueueRow: REQUEST_ROW, confirming: null })

    expect(crmReducer(opened, { type: 'close' })).toMatchObject({
      selected: null,
      selectedQueueRow: null
    })
  })
})
