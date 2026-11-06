import { describe, expect, it } from 'vitest'
import { placeholderDataset as data } from '@/data/placeholder'
import { buildActions } from './actions'
import { buildCase } from './caseModel'
import {
  buildEvents,
  filterCounts,
  pastEvents,
  scheduledEvents,
  scheduledHead,
  scheduledRest
} from './derive'
import { lifecycleOf, stageLabel } from './lifecycle'

const events = buildEvents(data)

describe('reviewed lifecycle integrity rules', () => {
  it('uses the ingest day field instead of parsing the UTC timestamp', () => {
    const ingest = events.find(event => event.kind === 'ingest')
    expect(data.ingest.runAt).toBe('28 Aug 03:04 UTC')
    expect(ingest?.day).toBe('2026-08-28')
  })

  it('keeps scheduled expiries outside the past stream and its counts', () => {
    const past = pastEvents(data, events)
    const scheduled = scheduledEvents(data, events)
    expect(events).toHaveLength(96)
    expect(past).toHaveLength(85)
    expect(scheduled).toHaveLength(11)
    expect(filterCounts(past)).toEqual({ all: 85, registered: 21, granted: 37, expired: 26 })
    expect(scheduled.every(event => event.day > data.today)).toBe(true)
    expect(scheduledHead(data, scheduled)[0]).toEqual({
      date: '01 Sep',
      rel: 'in 3 days',
      what: 'tenant-g.atlassian.net — space SRVDEV'
    })
    expect(scheduledRest(data, scheduled)).toContain('Then 26 Nov, 06 Apr 27, 31 Dec 27')
  })

  it('keeps source data for every Today right-rail card', () => {
    expect(data.byApp.map(row => row.n)).toEqual([16, 3, 2, 0])
    expect(data.steps.reduce((total, row) => total + row.welcome + row.lapsed, 0)).toBe(1407)
    expect(data.gaps).toHaveLength(4)
  })

  it('keeps skipped grant stages distinct from todo and done', () => {
    const grant = data.grants.find(row => row.origin === 'ZEN-1208')
    expect(grant).toBeDefined()
    const view = lifecycleOf(data, 'granted', grant ?? null)
    expect(view.stages.find(stage => stage.name === 'checking')?.state).toBe('skip')
    expect(view.stages.find(stage => stage.name === 'ready-to-grant')?.state).toBe('skip')
    expect(view.stages.find(stage => stage.name === 'applying')?.state).toBe('done')
  })

  it('lets the open repeat stage own the rail label', () => {
    const grant = data.grants.find(row => row.origin === 'ZEN-1202')
    const view = lifecycleOf(data, 'granted', grant ?? null)
    expect(stageLabel(view)).toBe('already-applied · 7 of 7')
  })

  it('suppresses every write action while a Welcome case is blocked', () => {
    const event = events.find(row => row.kind === 'registered')
    expect(event).toBeDefined()
    const model = buildCase(data, event!)
    const actions = buildActions(model, event!.id, null, {})
    expect(actions.next.stalled).toBe(true)
    expect(actions.next.showButton).toBe(false)
    expect(actions.more.find(action => action.key === 'release')).toMatchObject({
      held: true,
      showButton: false
    })
    expect(actions.more.find(action => action.key === 'internal')).toMatchObject({
      held: true,
      showButton: false
    })
    expect(actions.more.find(action => action.key === 'profile')?.showButton).toBe(true)
  })

  it('keeps recipient tracks separate for every case kind', () => {
    const registered = buildCase(data, events.find(row => row.kind === 'registered')!)
    const granted = buildCase(data, events.find(row => row.kind === 'granted')!)
    const expired = buildCase(data, events.find(row => row.kind === 'expired')!)
    const ingest = buildCase(data, events.find(row => row.kind === 'ingest')!)
    expect(registered.tracks).toHaveLength(3)
    expect(granted.tracks).toHaveLength(2)
    expect(expired.tracks).toHaveLength(1)
    expect(ingest.tracks).toHaveLength(1)
  })

  it('adds typed target facts only on mismatch', () => {
    const matching = events.find(row => row.kind === 'granted' && row.grant?.origin === 'ZEN-1208')
    const mismatched = events.find(row => row.kind === 'granted' && row.grant?.origin === 'ZEN-1206')
    expect(buildCase(data, matching!).facts.some(row => row.k === 'typed domain')).toBe(false)
    expect(buildCase(data, matching!).facts.some(row => row.k === 'typed space')).toBe(false)
    expect(buildCase(data, mismatched!).facts.some(row => row.k === 'typed domain')).toBe(true)
  })
})
