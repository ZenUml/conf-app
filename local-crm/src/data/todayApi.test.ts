import { describe, expect, it } from 'vitest'
import { buildEvents, filterCounts, pastEvents, scheduledEvents } from '@/lib/derive'
import { INITIAL_EXTENSIONS_LOAD, type ExtensionsLoadState } from './extensionsApi'
import { placeholderDataset } from './placeholder'
import { buildTodayDataset, todayGrantMode } from './todayApi'
import type { Dataset, Grant } from './types'

function load(
  state: ExtensionsLoadState['state'],
  sourceErrors: Array<'marketplace' | 'jsm' | 'space_license_kv' | 'extension_action_d1'> = []
): ExtensionsLoadState {
  return {
    ...INITIAL_EXTENSIONS_LOAD,
    state,
    generatedAt: state === 'live' || state === 'partial'
      ? '2026-08-29T10:00:00.000Z'
      : null,
    sources: state === 'live' || state === 'partial'
      ? {
          marketplace: { state: sourceErrors.includes('marketplace') ? 'error' : 'ok', records: 1, detail: 'test' },
          jsm: { state: sourceErrors.includes('jsm') ? 'error' : 'ok', records: 1, detail: 'test' },
          space_license_kv: { state: sourceErrors.includes('space_license_kv') ? 'error' : 'ok', records: 1, detail: 'test' },
          extension_action_d1: { state: sourceErrors.includes('extension_action_d1') ? 'error' : 'ok', records: 0, detail: 'test' }
        }
      : null
    ,openRequests: null
  }
}

function liveGrant(overrides: Partial<Grant>): Grant {
  return {
    id: 'live-grant',
    created: '20 Aug',
    createdAt: '2026-08-20T10:00:00.000Z',
    domain: 'live-tenant',
    space: 'LIVE',
    origin: 'support:source-backed',
    expires: '20 Sep',
    expiresAt: '2026-09-20T10:00:00.000Z',
    status: 'active',
    active: true,
    cloudId: 'live-cloud',
    storedStatus: 'active',
    sourceObservedAt: '2026-08-29T10:00:00.000Z',
    actionAudit: [],
    history: [],
    unknowns: [],
    marketplace: [],
    ...overrides
  }
}

function liveDataset(grants: Grant[]): Dataset {
  return {
    ...placeholderDataset,
    today: '2026-08-29',
    grants,
    jsm: {
      'ZEN-999001': {
        requester: 'Source-backed requester',
        accountId: 'source-backed-account',
        status: 'Waiting for support',
        lastReply: '29 Aug',
        replies: 1,
        typedDomain: 'live-tenant',
        typedSpace: 'LIVE',
        portalUnsigned: null,
        note: ''
      }
    },
    origins: [{
      n: grants.length,
      label: 'Source-backed',
      accent: 'brand',
      note: 'Live grant origins',
      pattern: 'support:*'
    }]
  }
}

describe('Today live grant composition', () => {
  it('replaces only grant-backed fields when the live read succeeds', () => {
    const live = liveDataset([liveGrant({ ticketKey: 'ZEN-999001' })])
    const result = buildTodayDataset(placeholderDataset, live, load('live'))

    expect(result.today).toBe(live.today)
    expect(result.grants).toBe(live.grants)
    expect(result.jsm).toBe(live.jsm)
    expect(result.origins).toBe(live.origins)
    expect(result.registrations).toBe(placeholderDataset.registrations)
    expect(result.ingest).toBe(placeholderDataset.ingest)
    expect(result.marketplace).toBe(placeholderDataset.marketplace)
    expect(result.byApp).toBe(placeholderDataset.byApp)
    expect(result.steps).toBe(placeholderDataset.steps)
    expect(result.gaps).toBe(placeholderDataset.gaps)
    expect(result.rules).toBe(placeholderDataset.rules)
    expect(todayGrantMode(load('live'))).toBe('live')
  })

  it('keeps authoritative grants when an optional context source is unavailable', () => {
    const live = liveDataset([liveGrant({})])
    const partial = load('partial', ['marketplace'])

    expect(todayGrantMode(partial)).toBe('partial')
    expect(buildTodayDataset(placeholderDataset, live, partial).grants).toBe(live.grants)
  })

  it('treats a healthy empty KV snapshot as authoritative instead of restoring fixtures', () => {
    const live = liveDataset([])
    const result = buildTodayDataset(placeholderDataset, live, load('live'))

    expect(result.grants).toBe(live.grants)
    expect(result.grants).toEqual([])
    expect(buildEvents(result).some(event => event.kind === 'granted' || event.kind === 'expired'))
      .toBe(false)
  })

  it.each(['loading', 'error'] as const)(
    'shows no fixture grant or expiry rows while the live source is %s',
    state => {
      const result = buildTodayDataset(
        placeholderDataset,
        liveDataset([liveGrant({})]),
        load(state)
      )

      expect(result.grants).toEqual([])
      expect(result.jsm).toEqual({})
      expect(result.origins).toEqual([])
      expect(result.registrations).toBe(placeholderDataset.registrations)
      expect(buildEvents(result).some(event => event.kind === 'granted' || event.kind === 'expired'))
        .toBe(false)
    }
  )

  it('shows no fixture grants when the primary KV source is unavailable', () => {
    const kvUnavailable = load('partial', ['space_license_kv'])
    const result = buildTodayDataset(
      placeholderDataset,
      liveDataset([liveGrant({})]),
      kvUnavailable
    )

    expect(todayGrantMode(kvUnavailable)).toBe('unavailable')
    expect(result.grants).toEqual([])
    expect(buildEvents(result).some(event => event.kind === 'granted' || event.kind === 'expired'))
      .toBe(false)
  })

  it('uses live status and timestamps for Today grant, expiry and scheduled counts', () => {
    const live = liveDataset([
      liveGrant({ id: 'live-active' }),
      liveGrant({
        id: 'live-expired',
        status: 'expired',
        active: false,
        expires: '20 Aug',
        expiresAt: '2026-08-20T12:00:00.000Z'
      }),
      liveGrant({
        id: 'live-inactive',
        status: 'inactive',
        active: false,
        storedStatus: 'inactive'
      }),
      liveGrant({
        id: 'live-unknown',
        status: 'unknown',
        active: false,
        storedStatus: 'unknown'
      })
    ])
    const result = buildTodayDataset(placeholderDataset, live, load('partial'))
    const events = buildEvents(result)
    const past = pastEvents(result, events)
    const scheduled = scheduledEvents(result, events)

    expect(filterCounts(past)).toEqual({
      all: placeholderDataset.registrations.length + 6,
      registered: placeholderDataset.registrations.length,
      granted: 4,
      expired: 1
    })
    expect(scheduled.map(event => event.id)).toEqual(['grant:live-active:expires'])
    expect(events.filter(event => event.kind === 'granted').map(event => event.grant?.id))
      .toEqual(['live-active', 'live-expired', 'live-inactive', 'live-unknown'])
    expect(events.some(event => event.id.startsWith('grant:fixture-'))).toBe(false)
    expect(events.filter(event => event.kind === 'registered' || event.kind === 'ingest'))
      .toEqual(
        buildEvents(placeholderDataset)
          .filter(event => event.kind === 'registered' || event.kind === 'ingest')
      )
  })
})
