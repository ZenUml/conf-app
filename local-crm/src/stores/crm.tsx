import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode
} from 'react'
import { dataset, type AutomationRule, type Dataset } from '@/data'
import {
  buildEvents,
  buildSites,
  buildSiteStats,
  buildTenants,
  buildUnresolved,
  filterCounts,
  groupByDay,
  pastEvents,
  scheduledEvents,
  scheduledHead,
  scheduledRest,
  type CaseEvent,
  type FeedDay,
  type FeedFilter,
  type ScheduledDay,
  type SiteRow,
  type SiteStat,
  type TenantRow,
  type UnresolvedRow
} from '@/lib/derive'
import { buildCase, type CaseModel } from '@/lib/caseModel'
import { runnableActionIds } from '@/lib/actions'

export type Screen = 'today' | 'sites' | 'extensions' | 'pending' | 'automation'
export type DrawerTab = 'evidence' | 'comms' | 'audit'

export interface CrmState {
  screen: Screen
  filter: FeedFilter
  /** Selected event id. The drawer is open whenever this is non-null. */
  selected: string | null
  tab: DrawerTab
  /** Action key awaiting confirmation, as `<eventId>:<actionKey>`. */
  confirming: string | null
  /** `<eventId>:<actionKey>` to timestamp. Nothing here performs a real write. */
  done: Record<string, string>
  query: string
}

export const INITIAL_CRM_STATE: CrmState = {
  screen: 'today',
  filter: 'all',
  selected: null,
  tab: 'evidence',
  confirming: null,
  done: {},
  query: ''
}

type CrmAction =
  | { type: 'go'; screen: Screen }
  | { type: 'filter'; filter: FeedFilter }
  | { type: 'open'; id: string }
  | { type: 'close' }
  | { type: 'tab'; tab: DrawerTab }
  | { type: 'query'; query: string }
  | { type: 'run'; key: string; needsConfirm: boolean; stamp: string }
  | { type: 'confirm'; key: string; stamp: string }
  | { type: 'cancel' }

export function crmReducer(state: CrmState, action: CrmAction): CrmState {
  switch (action.type) {
    case 'go':
      return { ...state, screen: action.screen, filter: 'all' }
    case 'filter':
      return { ...state, filter: action.filter }
    case 'open':
      return { ...state, selected: action.id, confirming: null, tab: 'evidence' }
    case 'close':
      return { ...state, selected: null, confirming: null }
    case 'tab':
      return { ...state, tab: action.tab }
    case 'query':
      return { ...state, query: action.query }
    // A confirm-gated action is only armed here. It used to stamp as soon as a
    // second `run` arrived on the armed key, so a double-click on the CTA
    // confirmed itself. Stamping needs the confirm strip's own action.
    case 'run':
      if (action.needsConfirm) {
        return { ...state, confirming: action.key }
      }
      return {
        ...state,
        confirming: null,
        done: { ...state.done, [action.key]: action.stamp }
      }
    case 'confirm':
      if (state.confirming !== action.key) return state
      return {
        ...state,
        confirming: null,
        done: { ...state.done, [action.key]: action.stamp }
      }
    case 'cancel':
      return { ...state, confirming: null }
  }
}

interface ScheduledView {
  total: number
  head: ScheduledDay[]
  rest: string
}

export interface CrmStoreValue extends CrmState {
  data: Dataset
  feed: FeedDay[]
  counts: Record<FeedFilter, number>
  scheduled: ScheduledView
  sites: SiteRow[]
  siteStats: SiteStat[]
  tenants: TenantRow[]
  unresolved: UnresolvedRow[]
  rules: AutomationRule[]
  navCounts: Record<Screen, number>
  selectedEvent: CaseEvent | null
  detail: CaseModel | null
  sessionLog: string[]
  go: (screen: Screen) => void
  setFilter: (filter: FeedFilter) => void
  setTab: (tab: DrawerTab) => void
  setQuery: (query: string) => void
  open: (id: string) => void
  close: () => void
  run: (key: string, needsConfirm: boolean) => void
  confirmRun: (key: string) => void
  cancel: () => void
}

const EVENTS = buildEvents(dataset)
const PAST = pastEvents(dataset, EVENTS)
const AHEAD = scheduledEvents(dataset, EVENTS)
const SITES = buildSites(dataset)
const TENANTS = buildTenants(dataset)
const UNRESOLVED = buildUnresolved(dataset)
const COUNTS = filterCounts(PAST)
const SITE_STATS = buildSiteStats(dataset, SITES)
const SCHEDULED: ScheduledView = {
  total: AHEAD.length,
  head: scheduledHead(dataset, AHEAD),
  rest: scheduledRest(dataset, AHEAD)
}
const NAV_COUNTS: Record<Screen, number> = {
  today: dataset.registrations.length,
  sites: SITES.length,
  extensions: dataset.grants.length,
  pending: UNRESOLVED.length,
  automation: dataset.rules.length
}

const CrmContext = createContext<CrmStoreValue | null>(null)

function includes(needle: string, ...fields: Array<string | undefined>): boolean {
  if (!needle) return true
  return fields.some(field => field?.toLowerCase().includes(needle))
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * When the operator ran the action, read from the clock alone. The date used to
 * come from `data.today` — the dataset's as-of day — with the local time beside
 * it, so a dataset extracted earlier filed actions under the extraction date.
 */
export function stampNow(operator: string, now: Date = new Date()): string {
  const day = String(now.getDate()).padStart(2, '0')
  const month = MONTH_NAMES[now.getMonth()]
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return `${day} ${month} ${now.getFullYear()} ${time} · ${operator}`
}

/** An action key belongs to the case the drawer has open. */
export function isKeyForSelected(selected: string | null, key: string): boolean {
  return Boolean(selected) && key.startsWith(`${selected}:`)
}

export function CrmProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(crmReducer, INITIAL_CRM_STATE)
  const needle = state.query.trim().toLowerCase()

  const feed = useMemo(() => {
    const rows = PAST.filter(
      event =>
        (state.filter === 'all' || event.kind === state.filter) &&
        includes(
          needle,
          event.who,
          event.tag,
          event.what,
          event.meta,
          event.space,
          event.registration?.cloudId,
          event.grant?.origin
        )
    )
    return groupByDay(dataset, rows)
  }, [needle, state.filter])

  const sites = useMemo(
    () =>
      SITES.filter(site =>
        includes(needle, site.domain, site.cloudId, site.apps.join(' '), site.extensions, site.last)
      ),
    [needle]
  )

  const tenants = useMemo(
    () =>
      TENANTS.filter(tenant =>
        includes(
          needle,
          tenant.domain,
          String(tenant.grants),
          tenant.active,
          tenant.spaces,
          tenant.window
        )
      ),
    [needle]
  )

  const unresolved = useMemo(
    () =>
      UNRESOLVED.filter(row =>
        includes(needle, row.key, row.detail, row.audit, row.state, row.expires)
      ),
    [needle]
  )

  const rules = useMemo(
    () =>
      dataset.rules.filter(rule =>
        includes(needle, rule.title, rule.badge, rule.scope, rule.items.join(' '), rule.audit)
      ),
    [needle]
  )

  const selectedEvent = useMemo(
    () => EVENTS.find(event => event.id === state.selected) ?? null,
    [state.selected]
  )
  const detail = useMemo(
    () => (selectedEvent ? buildCase(dataset, selectedEvent) : null),
    [selectedEvent]
  )
  const sessionLog = useMemo(() => {
    if (!selectedEvent) return []
    return Object.keys(state.done)
      .filter(key => key.startsWith(`${selectedEvent.id}:`))
      .map(key => `${key.slice(selectedEvent.id.length + 1)} · ${state.done[key]}`)
  }, [selectedEvent, state.done])

  const go = useCallback((screen: Screen) => dispatch({ type: 'go', screen }), [])
  const setFilter = useCallback(
    (filter: FeedFilter) => dispatch({ type: 'filter', filter }),
    []
  )
  const setTab = useCallback((tab: DrawerTab) => dispatch({ type: 'tab', tab }), [])
  const setQuery = useCallback((query: string) => dispatch({ type: 'query', query }), [])
  const open = useCallback((id: string) => dispatch({ type: 'open', id }), [])
  const close = useCallback(() => dispatch({ type: 'close' }), [])
  const cancel = useCallback(() => dispatch({ type: 'cancel' }), [])
  const runnableIds = useMemo(() => {
    if (!selectedEvent || !detail) return new Set<string>()
    return runnableActionIds(detail, selectedEvent.id, state.confirming, state.done)
  }, [detail, selectedEvent, state.confirming, state.done])

  const run = useCallback(
    (key: string, needsConfirm: boolean) => {
      if (!isKeyForSelected(state.selected, key) || !runnableIds.has(key)) return
      dispatch({
        type: 'run',
        key,
        needsConfirm,
        stamp: stampNow(dataset.operator)
      })
    },
    [runnableIds, state.selected]
  )
  const confirmRun = useCallback(
    (key: string) => {
      if (!isKeyForSelected(state.selected, key) || !runnableIds.has(key)) return
      dispatch({ type: 'confirm', key, stamp: stampNow(dataset.operator) })
    },
    [runnableIds, state.selected]
  )

  const value = useMemo<CrmStoreValue>(
    () => ({
      ...state,
      data: dataset,
      feed,
      counts: COUNTS,
      scheduled: SCHEDULED,
      sites,
      siteStats: SITE_STATS,
      tenants,
      unresolved,
      rules,
      navCounts: NAV_COUNTS,
      selectedEvent,
      detail,
      sessionLog,
      go,
      setFilter,
      setTab,
      setQuery,
      open,
      close,
      run,
      confirmRun,
      cancel
    }),
    [
      state,
      feed,
      sites,
      tenants,
      unresolved,
      rules,
      selectedEvent,
      detail,
      sessionLog,
      go,
      setFilter,
      setTab,
      setQuery,
      open,
      close,
      run,
      confirmRun,
      cancel
    ]
  )

  return <CrmContext.Provider value={value}>{children}</CrmContext.Provider>
}

export function useCrmStore(): CrmStoreValue {
  const store = useContext(CrmContext)
  if (!store) throw new Error('useCrmStore must be used inside CrmProvider')
  return store
}
