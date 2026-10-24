/**
 * Adversarial suite. Every test here states an invariant the console must hold
 * for its own claims to be true, then attacks it with hostile input: dates the
 * parser was not written for, a dataset read on a different day, duplicate
 * grants, a case with its grant missing, a stage list with no current stage.
 *
 * A failure here is a finding, not a flake. Each block names what breaks in the
 * UI when the invariant does not hold.
 */
import { describe, expect, it } from 'vitest'
import type { Dataset, Grant } from '@/data/types'
import { placeholderDataset } from '@/data/placeholder'
import { bareYear, human, iso, isoOrNull, relative, setBareDateYear } from './format'
import { buildEvents, buildSites, buildSiteStats, pastEvents } from './derive'
import { grantState, lifecycleOf, stageLabel } from './lifecycle'
import { buildCase } from './caseModel'
import { runnableActionIds } from './actions'
import { crmReducer, INITIAL_CRM_STATE } from '@/stores/crm'

const data = placeholderDataset

function clone(patch: Partial<Dataset>): Dataset {
  return { ...data, ...patch }
}

const GRANT: Grant = {
  created: '10 Aug',
  domain: 'tenant-x',
  space: 'OPS',
  origin: 'ZEN-9001',
  expires: '17 Aug',
  active: false
}

describe('date parsing under hostile input', () => {
  it('reads a bare day-month against the dataset year, not a hardcoded one', () => {
    // The console is read "as of" data.today. A bare '27 Aug' belongs to the
    // year the console is read in, or every card is dated a year out.
    expect(bareYear()).toBe(data.today.slice(0, 4))
    try {
      setBareDateYear('2027')
      expect(iso('27 Aug')).toBe('2027-08-27')
      expect(human('2027-08-27')).toBe('27 Aug')
    } finally {
      setBareDateYear(data.today.slice(0, 4))
    }
  })

  it('round-trips every date it prints', () => {
    for (const value of ['27 Aug', '01 Sep', '26 Nov 25', '31 Dec 27']) {
      expect(human(iso(value))).toBe(value)
    }
  })

  it('refuses a date it cannot parse instead of inventing one', () => {
    // '2026-01-00' is not a day. It sorted, grouped and printed like one.
    expect(() => iso('not a date')).toThrow()
    expect(() => iso('unknown')).toThrow()
    expect(() => iso('30 Sept')).toThrow()
    expect(isoOrNull('unknown')).toBeNull()
  })

  it('never prints NaN to the operator', () => {
    expect(relative('not-a-day', data.today)).not.toContain('NaN')
  })
})

describe('case identity', () => {
  it('keeps a case id stable when the dataset gains a row', () => {
    // Ids are the key for the drawer selection AND for every action stamp in
    // `done`. If they are positional, an audit line moves to another customer
    // the moment the extraction is refreshed.
    const before = buildEvents(data)
    const after = buildEvents(
      clone({ grants: [{ ...GRANT, created: '29 Aug', expires: '05 Sep' }, ...data.grants] })
    )
    const target = before[10]
    const moved = after.find(event => event.id === target.id)
    expect(moved?.who).toBe(target.who)
    expect(moved?.day).toBe(target.day)
  })
})

describe('grant state machine', () => {
  it('flags a second grant on the same space on the same day as a repeat', () => {
    // Same space, same day, two writes. This is precisely the failure the
    // console exists to surface: nothing in KV stops a concurrent replay.
    const first: Grant = { ...GRANT, created: '10 Aug' }
    const second: Grant = { ...GRANT, created: '10 Aug' }
    const doubled = clone({ grants: [first, second] })
    expect(grantState(doubled, second)[0]).toBe('already-applied')
  })

  it('does not silently render the ingest lifecycle for a grant case', () => {
    // A grant case whose grant is missing falls through every branch and lands
    // on the ingest run's stages: read / classified / written / logged.
    const view = lifecycleOf(data, 'granted', null)
    expect(view.stages.map(stage => stage.name)).not.toContain('read')
  })

  it('never labels a stage as current when no stage is current', () => {
    const view = {
      stalled: false,
      branches: '',
      stages: [
        { name: 'received', state: 'done' as const, note: '' },
        { name: 'applied', state: 'done' as const, note: '' }
      ]
    }
    expect(stageLabel(view)).not.toBe('received · 1 of 2')
  })

  it('does not crash on a case with no stages', () => {
    expect(() => stageLabel({ stalled: false, branches: '', stages: [] })).not.toThrow()
  })
})

describe('dataset self-consistency', () => {
  it('agrees with itself about which grants are still running', () => {
    // `active` is a stored boolean; `expires` is the date the stream prints.
    // When they disagree the same grant reads "active" on Pending and
    // "expired" in the stream on the same screen refresh.
    const wrong = data.grants.filter(
      grant => Boolean(grant.active) !== iso(grant.expires) > data.today
    )
    expect(wrong.map(grant => `${grant.domain}/${grant.space}`)).toEqual([])
  })

  it('keeps an unidentifiable grant out of the site list', () => {
    // A grant whose cloud ID resolves to nothing has no site. Grouping it by
    // its placeholder domain invents a site row and inflates "sites on file".
    const sites = buildSites(data)
    expect(sites.map(site => site.domain).filter(domain => domain.startsWith('('))).toEqual([])
  })

  it('counts sites on file consistently with the rows it lists', () => {
    const sites = buildSites(data)
    const stat = buildSiteStats(data, sites).find(row => row.label === 'sites on file')
    expect(stat?.value).toBe(sites.filter(site => !site.domain.startsWith('(')).length)
  })

  it('never emits an expiry before its own grant', () => {
    const backwards = data.grants.filter(grant => iso(grant.expires) < iso(grant.created))
    expect(backwards).toEqual([])
  })
})

describe('action audit trail', () => {
  it('stamps an action with the wall-clock instant it ran', () => {
    // The stamp is built from data.today plus the operator's local time. Read a
    // dataset extracted yesterday and every action is filed under yesterday's
    // date with today's clock time.
    const stale = clone({ today: '2026-01-01' })
    const state = crmReducer(INITIAL_CRM_STATE, {
      type: 'run',
      key: 'e1:revoke',
      needsConfirm: false,
      stamp: `${stale.today} 00:00`
    })
    const stamped = state.done['e1:revoke']
    expect(stamped.startsWith(new Date().toISOString().slice(0, 4))).toBe(true)
  })

  it('does not let one repeated click serve as its own confirmation', () => {
    // ActionCard keeps the CTA mounted while the confirm strip is open, and the
    // second click sends the same key. The reducer reads a matching key as the
    // confirmation, so a double-click runs the action without the text being read.
    // Reproduced in the running console: "Apply migration 0025" stamped
    // `done · 30 Aug 2026 18:11` from two clicks on the CTA alone.
    const first = crmReducer(INITIAL_CRM_STATE, {
      type: 'run',
      key: 'ingest:migrate',
      needsConfirm: true,
      stamp: 'stamp-1'
    })
    const second = crmReducer(first, {
      type: 'run',
      key: 'ingest:migrate',
      needsConfirm: true,
      stamp: 'stamp-2'
    })
    expect(second.done['ingest:migrate']).toBeUndefined()
  })

  it('refuses to run an action the case has blocked', () => {
    // Every write action is suppressed while a case is blocked. The store checks
    // that set before dispatching, so the rule does not live in the UI alone.
    const event = buildEvents(data).find(row => row.kind === 'registered')!
    const model = buildCase(data, event)
    expect(model.blockers.length).toBeGreaterThan(0)
    const runnable = runnableActionIds(model, event.id, null, {})
    expect(runnable.has(`${event.id}:release`)).toBe(false)
    expect(runnable.has(`${event.id}:profile`)).toBe(true)
  })
})

describe('empty and degenerate datasets', () => {
  it('renders a stream with no rows at all', () => {
    const empty = clone({ registrations: [], grants: [] })
    expect(() => pastEvents(empty, buildEvents(empty))).not.toThrow()
  })

  it('survives a registration whose fields are empty strings', () => {
    const broken = clone({
      registrations: [
        { id: 'r0', seen: '', domain: '', cloudId: '', p: 'lite', licence: '', tier: '' }
      ]
    })
    const events = buildEvents(broken)
    expect(() => buildCase(broken, events[0])).not.toThrow()
    expect(events[0].day).not.toContain('undefined')
  })
})
