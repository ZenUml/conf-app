import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode
} from 'react'
import { dataset as initialDataset, type AutomationRule, type Dataset } from '@/data'
import {
  INITIAL_EXTENSIONS_LOAD,
  loadExtensionsDataset,
  type ExtensionsLoadState
} from '@/data/extensionsApi'
import {
  INITIAL_SITES_LOAD,
  loadSitesResponse,
  siteStatsFromResponse,
  sitesFromResponse,
  type SitesLoadState
} from '@/data/sitesApi'
import {
  INITIAL_LIFECYCLE_LOAD,
  loadLifecycleResponse,
  type LifecycleLoadState
} from '@/data/lifecycleApi'
import { buildTodayDataset } from '@/data/todayApi'
import {
  buildPendingDataset,
  buildPendingRows,
  type PendingAssignmentRow
} from '@/data/pendingApi'
import {
  buildEvents,
  buildTenants,
  filterCounts,
  groupByDay,
  latestGrantEventForDomain,
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
  type TenantRow
} from '@/lib/derive'
import { buildCase, type CaseModel } from '@/lib/caseModel'

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
  | { type: 'cancel' }

export function crmReducer(state: CrmState, action: CrmAction): CrmState {
  switch (action.type) {
    case 'go':
      return {
        ...state,
        screen: action.screen,
        filter: 'all',
        selected: null,
        confirming: null
      }
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
    case 'run':
      if (action.needsConfirm && state.confirming !== action.key) {
        return { ...state, confirming: action.key }
      }
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
  pendingRows: PendingAssignmentRow[]
  rules: AutomationRule[]
  navCounts: Record<Screen, number>
  selectedEvent: CaseEvent | null
  detail: CaseModel | null
  sessionLog: string[]
  extensionsLoad: ExtensionsLoadState
  sitesLoad: SitesLoadState
  lifecycleLoad: LifecycleLoadState
  go: (screen: Screen) => void
  setFilter: (filter: FeedFilter) => void
  setTab: (tab: DrawerTab) => void
  setQuery: (query: string) => void
  open: (id: string) => void
  openExtension: (domain: string) => void
  close: () => void
  run: (key: string, needsConfirm: boolean) => void
  cancel: () => void
}

const CrmContext = createContext<CrmStoreValue | null>(null)

function includes(needle: string, ...fields: Array<string | undefined>): boolean {
  if (!needle) return true
  return fields.some(field => field?.toLowerCase().includes(needle))
}

function humanToday(today: string): string {
  const [year, month, day] = today.split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${day} ${names[Number(month) - 1]} ${year}`
}

function stamp(today: string, operator: string): string {
  const now = new Date()
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return `${humanToday(today)} ${time} · ${operator}`
}

export function CrmProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(crmReducer, INITIAL_CRM_STATE)
  const [extensionsData, setExtensionsData] = useState(initialDataset)
  const [extensionsLoad, setExtensionsLoad] = useState(INITIAL_EXTENSIONS_LOAD)
  const [sitesResponse, setSitesResponse] = useState<Awaited<ReturnType<typeof loadSitesResponse>> | null>(null)
  const [sitesLoad, setSitesLoad] = useState(INITIAL_SITES_LOAD)
  const [lifecycleLoad, setLifecycleLoad] = useState(INITIAL_LIFECYCLE_LOAD)
  const todayData = useMemo(
    () => buildTodayDataset(initialDataset, extensionsData, extensionsLoad),
    [extensionsData, extensionsLoad]
  )
  const pendingData = useMemo(
    () => buildPendingDataset(initialDataset, extensionsData, extensionsLoad),
    [extensionsData, extensionsLoad]
  )
  // Today and Pending intentionally reuse only the source-backed grant fields.
  // Their unrelated registration/contact/workflow fields stay sanitized.
  const data = state.screen === 'extensions'
    ? extensionsData
    : state.screen === 'today'
      ? todayData
      : state.screen === 'pending'
        ? pendingData
        : state.screen === 'automation'
          ? extensionsLoad.state === 'live' || extensionsLoad.state === 'partial'
            ? extensionsData
            : { ...initialDataset, grants: [], jsm: {}, jsmUnconfirmedAuthor: [], origins: [] }
          : initialDataset
  const needle = state.query.trim().toLowerCase()

  useEffect(() => {
    let current = true
    loadExtensionsDataset(initialDataset)
      .then(result => {
        if (!current) return
        setExtensionsData(result.data)
        setExtensionsLoad(result.load)
      })
      .catch(error => {
        if (!current) return
        setExtensionsLoad({
          state: 'error',
          generatedAt: null,
          sources: null,
          summary: null,
          incompleteGrantCount: 0,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    return () => {
      current = false
    }
  }, [])

  useEffect(() => {
    let current = true
    loadLifecycleResponse()
      .then(data => {
        if (!current) return
        setLifecycleLoad({ state: 'live', generatedAt: data.generatedAt, data, error: null })
      })
      .catch(error => {
        if (!current) return
        setLifecycleLoad({ state: 'error', generatedAt: null, data: null, error: error instanceof Error ? error.message : String(error) })
      })
    return () => { current = false }
  }, [])

  useEffect(() => {
    let current = true
    loadSitesResponse()
      .then(result => {
        if (!current) return
        setSitesResponse(result)
        setSitesLoad({ state: 'live', generatedAt: result.generatedAt, summary: result.summary, error: null })
      })
      .catch(error => {
        if (!current) return
        setSitesLoad({ state: 'error', generatedAt: null, summary: null, error: error instanceof Error ? error.message : String(error) })
      })
    return () => { current = false }
  }, [])

  const events = useMemo(() => buildEvents(data), [data])
  const past = useMemo(() => pastEvents(data, events), [data, events])
  const ahead = useMemo(() => scheduledEvents(data, events), [data, events])
  const allSites = useMemo(
    () => sitesResponse ? sitesFromResponse(sitesResponse, extensionsData) : [],
    [sitesResponse, extensionsData]
  )
  const allTenants = useMemo(() => buildTenants(data), [data])
  const allPendingRows = useMemo(() => buildPendingRows(pendingData), [pendingData])
  const counts = useMemo(() => filterCounts(past), [past])
  const siteStats = useMemo(
    () => sitesResponse ? siteStatsFromResponse(sitesResponse, allSites, extensionsData) : [],
    [sitesResponse, allSites, extensionsData]
  )
  const scheduled = useMemo<ScheduledView>(() => ({
    total: ahead.length,
    head: scheduledHead(data, ahead),
    rest: scheduledRest(data, ahead)
  }), [ahead, data])
  const navCounts = useMemo<Record<Screen, number>>(() => ({
    today: initialDataset.registrations.length,
    sites: allSites.length,
    extensions: extensionsData.grants.length,
    pending: allPendingRows.length,
    automation: extensionsData.grants.reduce((total, grant) => total + (grant.actionAudit?.length ?? 0), 0)
  }), [allPendingRows.length, allSites.length, extensionsData.grants])

  const feed = useMemo(() => {
    const rows = past.filter(
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
    return groupByDay(data, rows)
  }, [data, needle, past, state.filter])

  const sites = useMemo(
    () =>
      allSites.filter(site =>
        includes(needle, site.domain, site.cloudId, site.apps.join(' '), site.extensions, site.last)
      ),
    [allSites, needle]
  )

  const tenants = useMemo(
    () =>
      allTenants.filter(tenant =>
        includes(
          needle,
          tenant.domain,
          String(tenant.grants),
          tenant.active,
          tenant.spaces,
          tenant.window
        )
      ),
    [allTenants, needle]
  )

  const pendingRows = useMemo(
    () =>
      allPendingRows.filter(row =>
        includes(
          needle,
          row.cloudPrefix,
          row.space,
          row.scope,
          row.status,
          row.reviewBand,
          row.mappingEvidence,
          row.requestEvidence,
          row.actionEvidence,
          row.origin,
          row.unknowns.join(' ')
        )
      ),
    [allPendingRows, needle]
  )

  const rules = useMemo(
    () =>
      data.rules.filter(rule =>
        includes(needle, rule.title, rule.badge, rule.scope, rule.items.join(' '), rule.audit)
      ),
    [data.rules, needle]
  )

  const selectedEvent = useMemo(
    () => events.find(event => event.id === state.selected) ?? null,
    [events, state.selected]
  )
  const detail = useMemo(
    () => (selectedEvent ? buildCase(data, selectedEvent) : null),
    [data, selectedEvent]
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
  const openExtension = useCallback((domain: string) => {
    const event = latestGrantEventForDomain(events, domain)
    if (event) dispatch({ type: 'open', id: event.id })
  }, [events])
  const close = useCallback(() => dispatch({ type: 'close' }), [])
  const cancel = useCallback(() => dispatch({ type: 'cancel' }), [])
  const run = useCallback(
    (key: string, needsConfirm: boolean) =>
      dispatch({
        type: 'run',
        key,
        needsConfirm,
        stamp: stamp(data.today, data.operator)
      }),
    [data.operator, data.today]
  )

  const value = useMemo<CrmStoreValue>(
    () => ({
      ...state,
      data,
      feed,
      counts,
      scheduled,
      sites,
      siteStats,
      tenants,
      pendingRows,
      rules,
      navCounts,
      selectedEvent,
      detail,
      sessionLog,
      extensionsLoad,
      sitesLoad,
      lifecycleLoad,
      go,
      setFilter,
      setTab,
      setQuery,
      open,
      openExtension,
      close,
      run,
      cancel
    }),
    [
      state,
      data,
      feed,
      counts,
      scheduled,
      sites,
      siteStats,
      tenants,
      pendingRows,
      rules,
      navCounts,
      selectedEvent,
      detail,
      sessionLog,
      extensionsLoad,
      sitesLoad,
      lifecycleLoad,
      go,
      setFilter,
      setTab,
      setQuery,
      open,
      openExtension,
      close,
      run,
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
