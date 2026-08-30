import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from '@/App'
import { INITIAL_EXTENSIONS_LOAD } from '@/data/extensionsApi'
import { automationStatus } from '@/components/TopBar'
import { DeferredLifecycleTodos } from '@/screens/AutomationScreen'
import { buildActions, isCurrentScopeCase, type DrawerActionModel } from '@/lib/actions'
import type { CaseModel } from '@/lib/caseModel'
import { CrmProvider, crmReducer, INITIAL_CRM_STATE } from './crm'
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
    lastCommentFirstLine: 'First line',
    reason: null,
    unavailableReasons: {}
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

describe('current UI scope', () => {
  it('renders Today as an untitled queue', () => {
    const html = renderToStaticMarkup(
      createElement(CrmProvider, null, createElement(App))
    )

    expect(html).not.toMatch(/<h1[^>]*>Today<\/h1>/)
    expect(html).toContain('data-testid="today-queue"')
  })

  it('shows Welcome and Expiry/Cancellation only as TODOs', () => {
    const html = renderToStaticMarkup(createElement(DeferredLifecycleTodos))

    expect(html).toContain('Welcome · TODO')
    expect(html).toContain('Expiry / cancellation · TODO')
    expect(html).not.toMatch(/preview|contacts|lifecycle observations/i)
    expect(html).not.toContain('<iframe')
    expect(html).not.toContain('<table')
  })

  it('does not expose unconfirmed revoke or regrant affordances', () => {
    const model = {
      actions: [
        { key: 'verify', label: 'Review current evidence', cta: 'Review' },
        { key: 'revoke', label: 'Revoke is read-only here', blocked: 'not connected' },
        { key: 'regrant', label: 'Renew is read-only here', blocked: 'not connected' }
      ],
      blockers: [],
      nextKey: 'verify',
      nextLabel: 'Review current evidence',
      nextWhy: 'Read-only evidence is in scope.'
    } satisfies DrawerActionModel

    const actions = buildActions(model, 'grant:g1:created', null, {})

    expect(actions.next.key).toBe('verify')
    expect(actions.more.map(action => action.key)).toEqual([])
  })

  it('allows only Extension cases into the drawer', () => {
    const model = (caseType: string) => ({ caseType }) as CaseModel

    expect(isCurrentScopeCase(model('Extension'))).toBe(true)
    expect(isCurrentScopeCase(model('Welcome'))).toBe(false)
    expect(isCurrentScopeCase(model('Retention'))).toBe(false)
    expect(isCurrentScopeCase(model('Ingest run'))).toBe(false)
  })

  it('describes Automation without lifecycle dashboard signals', () => {
    const copy = automationStatus(
      { ...INITIAL_EXTENSIONS_LOAD, state: 'error', error: 'unavailable' },
      0
    ).join(' ')

    expect(copy).toContain('ExtensionAction')
    expect(copy).not.toMatch(/lifecycle|contact|welcome|expiry|cancell/i)
  })
})
