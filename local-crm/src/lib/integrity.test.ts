import { describe, expect, it } from 'vitest'
import { placeholderDataset as data } from '@/data/placeholder'
import { buildActions } from './actions'
import { buildCase } from './caseModel'
import {
  buildEvents,
  filterCounts,
  latestGrantEventForDomain,
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
      what: 'tenant-g.atlassian.net — space DEMO06'
    })
    expect(scheduledRest(data, scheduled)).toContain('Then 26 Nov, 06 Apr 27, 31 Dec 27')
  })

  it('keeps source data for every Today right-rail card', () => {
    expect(data.byApp.map(row => row.n)).toEqual([16, 3, 2, 0])
    expect(data.steps.reduce((total, row) => total + row.welcome + row.lapsed, 0)).toBe(1407)
    expect(data.gaps).toHaveLength(4)
  })

  it('keeps skipped grant stages distinct from todo and done', () => {
    const grant = data.grants.find(row => row.origin === 'ZEN-990015')
    expect(grant).toBeDefined()
    const view = lifecycleOf(data, 'granted', grant ?? null)
    expect(view.stages.find(stage => stage.name === 'checking')?.state).toBe('skip')
    expect(view.stages.find(stage => stage.name === 'ready-to-grant')?.state).toBe('skip')
    expect(view.stages.find(stage => stage.name === 'applying')?.state).toBe('done')
  })

  it('does not infer repeat history from another current KV target', () => {
    const grant = data.grants.find(row => row.origin === 'ZEN-990009')
    const view = lifecycleOf(data, 'granted', grant ?? null)
    expect(stageLabel(view)).toBe('applied · 6 of 7')
    expect(view.stages.find(stage => stage.name === 'already-applied')).toMatchObject({
      state: 'skip'
    })
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
    const matching = events.find(row => row.kind === 'granted' && row.grant?.origin === 'ZEN-990015')
    const mismatched = events.find(row => row.kind === 'granted' && row.grant?.origin === 'ZEN-990013')
    expect(buildCase(data, matching!).facts.some(row => row.k === 'typed domain')).toBe(false)
    expect(buildCase(data, matching!).facts.some(row => row.k === 'typed space')).toBe(false)
    expect(buildCase(data, mismatched!).facts.some(row => row.k === 'typed domain')).toBe(true)
  })

  it('labels domain-space JSM evidence as correlation, never grant origin', () => {
    const grant = {
      ...data.grants[0],
      id: 'grant_correlated',
      origin: 'support:manual-extension',
      activatedBy: 'support:manual-extension',
      ticketKey: undefined,
      requestTicket: 'ZEN-999999',
      requestMatchedBy: 'domain_space' as const,
      status: 'active' as const,
      active: true,
      userAccountId: 'target-account'
    }
    const correlated = {
      ...data,
      grants: [grant],
      jsm: {
        'ZEN-999999': {
          requester: 'Synthetic requester',
          accountId: 'target-account',
          reporterAccountId: 'reporter-account',
          status: 'Waiting for support',
          lastReply: '29 Aug',
          replies: 1,
          typedDomain: grant.domain,
          typedSpace: grant.space,
          portalUnsigned: false,
          note: 'matched by domain + space, target scope and causal time',
          matchedBy: 'domain_space' as const
        }
      }
    }
    const event = buildEvents(correlated).find(row => row.kind === 'granted')!
    const model = buildCase(correlated, event)

    expect(model.tracks[0].who).toContain('not proven grant origin')
    expect(model.nextWhy).toContain('not recorded as this grant\'s origin')
    expect(model.lifecycle.stages.find(stage => stage.name === 'received')?.note)
      .toContain('not proven to be this grant\'s origin')
  })

  it('shows unavailable action evidence as unknown rather than zero rows', () => {
    const grant = {
      ...data.grants[0],
      id: 'grant_audit_unavailable',
      status: 'active' as const,
      actionAudit: [],
      unknowns: ['ExtensionAction audit source is unavailable']
    }
    const isolated = { ...data, grants: [grant] }
    const event = buildEvents(isolated).find(row => row.kind === 'granted')!
    const model = buildCase(isolated, event)

    expect(model.facts.find(row => row.k === 'ExtensionAction')?.v).toBe('source unavailable')
    expect(model.audits.find(row => row.k === 'ExtensionAction')?.v).toBe('source unavailable')
    expect(model.footer).toContain('absence cannot be established')
  })

  it('keeps unavailable Marketplace and action evidence unknown in expiry cases', () => {
    const grant = {
      ...data.grants[0],
      id: 'grant_expiry_sources_unavailable',
      createdAt: '2026-08-01T00:00:00.000Z',
      expiresAt: '2026-08-20T00:00:00.000Z',
      created: '01 Aug',
      expires: '20 Aug',
      days: undefined,
      status: 'expired' as const,
      active: false,
      marketplace: [],
      actionAudit: [],
      unknowns: [
        'Marketplace site mapping is unavailable',
        'ExtensionAction audit source is unavailable'
      ]
    }
    const isolated = { ...data, grants: [grant] }
    const event = buildEvents(isolated).find(row => row.kind === 'expired')!
    const model = buildCase(isolated, event)

    expect(model.facts.find(row => row.k === 'ran')?.v).toBe('duration unknown')
    expect(model.facts.find(row => row.k === 'Marketplace')?.v).toContain('source unavailable')
    expect(model.audits.find(row => row.k === 'ExtensionAction')?.v).toBe('source unavailable')
    expect(model.classes.find(row => row.name === 'evaluation-ended')).toMatchObject({
      verdict: 'unknown',
      applies: false
    })
    expect(model.classes.find(row => row.name === 'marketplace-lapsed')?.note)
      .toContain('source is unavailable')
  })

  it('does not present requester-typed domain context as a mismatch when site mapping is unavailable', () => {
    const grant = {
      ...data.grants[0],
      id: 'grant_marketplace_unavailable',
      domain: '(site mapping unavailable · cloud example)',
      ticketKey: 'ZEN-999999',
      requestTicket: 'ZEN-999999',
      requestMatchedBy: 'ticket_key' as const,
      status: 'active' as const,
      active: true,
      marketplace: [],
      unknowns: ['Marketplace site mapping is unavailable']
    }
    const isolated = {
      ...data,
      grants: [grant],
      jsm: {
        'ZEN-999999': {
          requester: 'Synthetic requester',
          accountId: 'synthetic-account',
          status: 'Waiting for support',
          lastReply: '29 Aug',
          replies: 1,
          typedDomain: 'requester-typed-example',
          typedSpace: grant.space,
          portalUnsigned: null,
          note: ''
        }
      }
    }
    const event = buildEvents(isolated).find(row => row.kind === 'granted')!
    const model = buildCase(isolated, event)

    expect(model.facts.find(row => row.k === 'Marketplace')?.v).toContain('source unavailable')
    expect(model.facts.some(row => row.k === 'typed domain')).toBe(false)
  })

  it('does not attribute a shared expiry day to one of several tenants', () => {
    const base = data.grants.find(row => row.active) ?? data.grants[0]
    const sharedDay = {
      ...data,
      registrations: [],
      grants: [
        {
          ...base,
          id: 'grant_tenant_one',
          domain: 'example-one',
          space: 'SPACE1',
          status: 'active' as const,
          active: true,
          expires: '01 Sep',
          expiresAt: '2026-09-01T00:00:00.000Z'
        },
        {
          ...base,
          id: 'grant_tenant_two',
          domain: 'example-two',
          space: 'SPACE2',
          status: 'active' as const,
          active: true,
          expires: '01 Sep',
          expiresAt: '2026-09-01T00:00:00.000Z'
        }
      ]
    }
    const ahead = scheduledEvents(sharedDay, buildEvents(sharedDay))

    expect(scheduledHead(sharedDay, ahead)[0].what).toBe('2 expiries across 2 tenants')
  })

  it('opens the newest grant by full timestamp when two grants share a day', () => {
    const base = data.grants[0]
    const sameTenant = {
      ...data,
      registrations: [],
      grants: [
        { ...base, id: 'grant_a', created: '20 Aug', createdAt: '2026-08-20T10:00:00.000Z' },
        { ...base, id: 'grant_z', created: '20 Aug', createdAt: '2026-08-20T10:00:12.000Z' }
      ]
    }
    const sameDayEvents = buildEvents(sameTenant)
    const latest = latestGrantEventForDomain(sameDayEvents, `${base.domain}.atlassian.net`)

    expect(latest?.grant?.id).toBe('grant_z')
  })
})
