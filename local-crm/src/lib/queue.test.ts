import { describe, expect, it } from 'vitest'
import type { Grant } from '@/data/types'
import type { OpenExtensionRequest, OpenExtensionRequestStream } from '@/data/extensionsContract'
import { buildQueue, CLOSE_IDLE_DAYS, EXPIRING_WITHIN_DAYS, NUDGE_IDLE_DAYS, SETTLED_WINDOW_DAYS } from './queue'

const TODAY = '2026-08-30'

function request(overrides: Partial<OpenExtensionRequest>): OpenExtensionRequest {
  return {
    ticketKey: 'ZEN-1000',
    status: 'Waiting for support',
    createdAt: '2026-08-29T00:00:00.000Z',
    updatedAt: '2026-08-29T00:00:00.000Z',
    typedDomain: 'tenant-a',
    typedSpace: 'OPS',
    currentGrant: 'not_observed',
    cloudId: 'cloud-a',
    requester: 'someone@tenant-a.example',
    macroCount: 1836,
    macrosLimit: 100,
    priorGrants: { count: 0, activeCount: 0, latestExpiresAt: null },
    comments: {
      state: 'known',
      publicCommentCount: 1,
      requesterCommentCount: 0,
      lastCommentAt: '2026-08-29T01:00:00.000Z',
      lastCommentAuthor: 'Peng Xiao',
      lastCommentAuthorship: 'non_requester',
      reason: null
    },
    ...overrides
  }
}

function stream(rows: OpenExtensionRequest[]): OpenExtensionRequestStream {
  return {
    state: 'complete',
    detail: 'test',
    rows,
    summary: { currentGrantObserved: 0, noCurrentGrantObserved: rows.length, insufficientEvidence: 0 }
  }
}

function grant(overrides: Partial<Grant>): Grant {
  return {
    id: 'grant-1',
    created: '20 Aug',
    createdAt: '2026-08-20T00:00:00.000Z',
    domain: 'tenant-a',
    space: 'OPS',
    origin: 'support:temp-7d-extension:ZEN-1000',
    expires: '01 Sep',
    expiresAt: '2026-09-01T23:59:59.000Z',
    status: 'active',
    cloudId: 'cloud-a',
    ...overrides
  } as Grant
}

describe('what enters the queue', () => {
  it('takes a request only while the next move is ours', () => {
    const { rows } = buildQueue({
      grants: [],
      openRequests: stream([
        request({ ticketKey: 'ZEN-A', status: 'Waiting for support' }),
        request({ ticketKey: 'ZEN-B', status: 'In Progress' }),
        request({ ticketKey: 'ZEN-C', status: 'Work in progress' }),
        // parked on the customer and still fresh: not our move
        request({ ticketKey: 'ZEN-D', status: 'Waiting for customer', updatedAt: '2026-08-28T00:00:00.000Z' })
      ]),
      today: TODAY
    })
    expect(rows.map(row => row.ticketKey)).toEqual(['ZEN-A', 'ZEN-B', 'ZEN-C'])
  })

  it('returns a quiet request at the nudge threshold and again at the close threshold', () => {
    const idle = (days: number) => {
      const date = new Date(`${TODAY}T00:00:00.000Z`)
      date.setUTCDate(date.getUTCDate() - days)
      return date.toISOString()
    }
    const { rows } = buildQueue({
      grants: [],
      openRequests: stream([
        request({ ticketKey: 'ZEN-FRESH', status: 'Waiting for customer', updatedAt: idle(NUDGE_IDLE_DAYS - 1) }),
        request({ ticketKey: 'ZEN-NUDGE', status: 'Waiting for customer', updatedAt: idle(NUDGE_IDLE_DAYS) }),
        request({ ticketKey: 'ZEN-CLOSE', status: 'Waiting for customer', updatedAt: idle(CLOSE_IDLE_DAYS) })
      ]),
      today: TODAY
    })
    expect(rows.find(row => row.ticketKey === 'ZEN-FRESH')).toBeUndefined()
    expect(rows.find(row => row.ticketKey === 'ZEN-NUDGE')?.reason).toBe('nudge')
    expect(rows.find(row => row.ticketKey === 'ZEN-CLOSE')?.reason).toBe('close')
  })

  it('takes a grant only while its expiry is inside the window', () => {
    const { rows } = buildQueue({
      grants: [
        grant({ id: 'soon', expiresAt: '2026-09-01T23:59:59.000Z' }),
        grant({ id: 'later', expiresAt: '2026-10-01T23:59:59.000Z' }),
        grant({ id: 'gone', expiresAt: '2026-08-20T23:59:59.000Z', status: 'expired' })
      ],
      openRequests: null,
      today: TODAY
    })
    expect(rows.map(row => row.id)).toEqual(['expiry:soon'])
    expect(EXPIRING_WITHIN_DAYS).toBe(7)
  })

  it('leaves out a request whose grant already exists', () => {
    const { rows } = buildQueue({
      grants: [],
      openRequests: stream([request({ ticketKey: 'ZEN-DONE', currentGrant: 'observed' })]),
      today: TODAY
    })
    expect(rows).toEqual([])
  })
})

describe('ordering', () => {
  it('puts the newest stored date first while retaining the action score', () => {
    const idle = (days: number) => {
      const date = new Date(`${TODAY}T00:00:00.000Z`)
      date.setUTCDate(date.getUTCDate() - days)
      return date.toISOString()
    }
    const { rows } = buildQueue({
      grants: [grant({ id: 'soon', expiresAt: '2026-09-01T23:59:59.000Z' })],
      openRequests: stream([
        request({ ticketKey: 'ZEN-STALE', status: 'Waiting for customer', updatedAt: idle(507) }),
        request({ ticketKey: 'ZEN-NOW', status: 'Waiting for support' })
      ]),
      today: TODAY
    })
    expect(rows.map(row => row.ticketKey ?? row.id)).toEqual(['expiry:soon', 'ZEN-NOW', 'ZEN-STALE'])
    expect(rows.map(row => row.score)).toEqual([2, 0, -417]) // 507 idle days is past the close threshold, not the nudge one
  })

  it('opens the grant case behind an expiry row, and nothing behind a request', () => {
    const { rows } = buildQueue({
      grants: [grant({ id: 'soon' })],
      openRequests: stream([request({})]),
      today: TODAY
    })
    expect(rows.find(row => row.reason === 'expiring')?.eventId).toBe('grant:soon:created')
    expect(rows.find(row => row.reason === 'waiting_on_support')?.eventId).toBeNull()
  })

  it('dates every row from a stored field', () => {
    const { rows } = buildQueue({
      grants: [grant({ id: 'soon' })],
      openRequests: stream([request({})]),
      today: TODAY
    })
    expect(rows.map(row => row.date)).toEqual(['2026-09-01', '2026-08-29'])
  })
})

describe('what a row carries', () => {
  it('hands over a command built from the request itself', () => {
    const { rows } = buildQueue({
      grants: [],
      openRequests: stream([request({ cloudId: 'cloud-a', typedSpace: 'OPS' })]),
      today: TODAY
    })
    expect(rows[0].command).toContain('cloud-a')
    expect(rows[0].command).toContain('OPS')
  })

  it('says nothing about a command when the site did not resolve', () => {
    const { rows } = buildQueue({
      grants: [],
      openRequests: stream([request({ cloudId: null })]),
      today: TODAY
    })
    expect(rows[0].command).toBeNull()
  })

  it('states the macro count against the limit, and the prior grants on that space', () => {
    const { rows } = buildQueue({
      grants: [],
      openRequests: stream([
        request({ macroCount: 1836, macrosLimit: 100, priorGrants: { count: 4, activeCount: 1, latestExpiresAt: '2026-09-03T23:59:59.000Z' } })
      ]),
      today: TODAY
    })
    expect(rows[0].evidence).toContain('1,836 macros · limit 100')
    expect(rows[0].evidence).toContain('4 prior grants')
    expect(rows[0].evidence).toContain('1 active')
  })
})

describe('settled tail', () => {
  it('keeps the last two weeks of grants and expiries, and nothing older', () => {
    const { settled } = buildQueue({
      grants: [
        grant({ id: 'fresh', createdAt: '2026-08-28T00:00:00.000Z', expiresAt: '2026-09-04T23:59:59.000Z' }),
        grant({ id: 'old', createdAt: '2026-07-01T00:00:00.000Z', expiresAt: '2026-07-08T23:59:59.000Z', status: 'expired' })
      ],
      openRequests: null,
      today: TODAY
    })
    expect(SETTLED_WINDOW_DAYS).toBe(14)
    expect(settled.some(row => row.text.includes('OPS'))).toBe(true)
    expect(settled.every(row => row.date >= '2026-08-16')).toBe(true)
  })
})

describe('deferred lifecycles', () => {
  it('marks welcome and expiry as todo, with the reason', () => {
    const { todos } = buildQueue({ grants: [], openRequests: null, today: TODAY })
    expect(todos.map(todo => todo.lifecycle)).toEqual(['welcome', 'expiry'])
    expect(todos[0].note.length).toBeGreaterThan(0)
    expect(todos[1].note.length).toBeGreaterThan(0)
  })
})
