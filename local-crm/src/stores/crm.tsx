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
import { datasetSelection, type AutomationRule, type Dataset } from '@/data'
import { shouldLoadLiveSources } from '@/data/datasetSelection'
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
import { buildQueue } from '@/lib/queue'
import type { QueueRow } from '@/lib/queue'
import { buildActions } from '@/lib/actions'

export type Screen = 'today' | 'sites' | 'extensions' | 'automation'
export type DrawerTab = 'evidence' | 'comms' | 'audit'

export interface CrmState {
  screen: Screen
  filter: FeedFilter
  /** Selected event id. The drawer is open whenever this is non-null. */
  selected: string | null
  /** A Today request has no grant event, so its drawer keeps the queue projection. */
  selectedQueueRow: QueueRow | null
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
  selectedQueueRow: null,
  tab: 'evidence',
  confirming: null,
  done: {},
  query: ''
}

type CrmAction =
  | { type: 'go'; screen: Screen }
  | { type: 'filter'; filter: FeedFilter }
  | { type: 'open'; id: string }
  | { type: 'openQueue'; row: QueueRow }
  | { type: 'close' }
  | { type: 'tab'; tab: DrawerTab }
  | { type: 'query'; query: string }
  | { type: 'run'; key: string; needsConfirm: boolean; stamp: string }
  | { type: 'confirm'; key: string; stamp: string }
  | { type: 'cancel' }

export function crmReducer(state: CrmState, action: CrmAction): CrmState {
  switch (action.type) {
    case 'go':
      return {
        ...state,
        screen: action.screen,
        filter: 'all',
        selected: null,
        selectedQueueRow: null,
        confirming: null
      }
    case 'filter':
      return { ...state, filter: action.filter }
    case 'open':
      return { ...state, selected: action.id, selectedQueueRow: null, confirming: null, tab: 'evidence' }
    case 'openQueue':
      return { ...state, selected: null, selectedQueueRow: action.row, confirming: null, tab: 'evidence' }
    case 'close':
      return { ...state, selected: null, selectedQueueRow: null, confirming: null }
    case 'tab':
      return { ...state, tab: action.tab }
    case 'query':
      return { ...state, query: action.query }
    // A confirm-gated action is only ever armed here. It used to stamp as soon
    // as a second `run` arrived on the armed key, so a double-click on the CTA
    // confirmed itself: "Apply migration 0025" stamped from two clicks with the
    // confirm strip untouched. Stamping now needs the strip's own action.
    case 'run':
      if (action.needsConfirm) {
        return { ...state, confirming: action.key }
      }
      if (state.confirming === action.key) return state
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
  rules: AutomationRule[]
  navCounts: Record<Screen, number>
  selectedEvent: CaseEvent | null
  selectedQueueRow: QueueRow | null
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
  openQueue: (row: QueueRow) => void
  openExtension: (domain: string) => void
  close: () => void
  run: (key: string, needsConfirm: boolean) => void
  confirmRun: (key: string) => void
  cancel: () => void
}

const CrmContext = createContext<CrmStoreValue | null>(null)

function includes(needle: string, ...fields: Array<string | null | undefined>): boolean {
  if (!needle) return true
  return fields.some(field => field?.toLowerCase().includes(needle))
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * When the operator ran the action, read from the clock alone.
 *
 * The date used to come from `data.today` — the dataset's as-of day — while the
 * time came from the local clock. A dataset extracted on an earlier day filed
 * every action under the extraction date with the current time beside it.
 */
export function stampNow(operator: string, now: Date = new Date()): string {
  const day = String(now.getDate()).padStart(2, '0')
  const month = MONTH_NAMES[now.getMonth()]
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  return `${day} ${month} ${now.getFullYear()} ${time} · ${operator}`
}

/**
 * An action key belongs to the case the drawer has open. Only the drawer renders
 * action controls, so anything arriving for another case did not come from one.
 */
export function isKeyForSelected(selected: string | null, key: string): boolean {
  return Boolean(selected) && key.startsWith(`${selected}:`)
}

export function CrmProvider({ children }: { children: ReactNode }) {
  const initialDataset = datasetSelection.data
  if (!initialDataset) {
    throw new Error(datasetSelection.reason)
  }
  const [state, dispatch] = useReducer(crmReducer, INITIAL_CRM_STATE)
  const [extensionsData, setExtensionsData] = useState(initialDataset)
  const liveSourcesEnabled = shouldLoadLiveSources(datasetSelection)
  const [extensionsLoad, setExtensionsLoad] = useState<ExtensionsLoadState>(liveSourcesEnabled
    ? INITIAL_EXTENSIONS_LOAD
    : {
        state: 'error', generatedAt: null, sources: null, summary: null,
        incompleteGrantCount: 0, openRequests: null,
        error: 'Live sources are disabled in explicit fixture mode.'
      })
  const [sitesResponse, setSitesResponse] = useState<Awaited<ReturnType<typeof loadSitesResponse>> | null>(null)
  const [sitesLoad, setSitesLoad] = useState<SitesLoadState>(liveSourcesEnabled
    ? INITIAL_SITES_LOAD
    : { state: 'error', generatedAt: null, summary: null, error: 'Live sources are disabled in explicit fixture mode.' })
  const [lifecycleLoad, setLifecycleLoad] = useState<LifecycleLoadState>(liveSourcesEnabled
    ? INITIAL_LIFECYCLE_LOAD
    : { state: 'error', generatedAt: null, data: null, error: 'Live sources are disabled in explicit fixture mode.' })
  const todayData = useMemo(
    () => buildTodayDataset(initialDataset, extensionsData, extensionsLoad, lifecycleLoad),
    [extensionsData, extensionsLoad, lifecycleLoad]
  )
  // Today intentionally reuses only the source-backed grant fields.
  // Its unrelated registration/contact/workflow fields stay sanitized.
  const data = state.screen === 'extensions'
    ? extensionsData
    : state.screen === 'today'
      ? todayData
      : state.screen === 'automation'
          ? extensionsLoad.state === 'live' || extensionsLoad.state === 'partial'
            ? extensionsData
            : { ...initialDataset, grants: [], jsm: {}, jsmUnconfirmedAuthor: [], origins: [] }
          : initialDataset
  const needle = state.query.trim().toLowerCase()

  useEffect(() => {
    if (!liveSourcesEnabled) return
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
          openRequests: null,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    return () => {
      current = false
    }
  }, [liveSourcesEnabled])

  useEffect(() => {
    if (!liveSourcesEnabled) return
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
  }, [liveSourcesEnabled])

  useEffect(() => {
    if (!liveSourcesEnabled) return
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
  }, [liveSourcesEnabled])

  const events = useMemo(() => buildEvents(data), [data])
  const past = useMemo(() => pastEvents(data, events), [data, events])
  const ahead = useMemo(() => scheduledEvents(data, events), [data, events])
  const allSites = useMemo(
    () => sitesResponse ? sitesFromResponse(sitesResponse, extensionsData, lifecycleLoad.data) : [],
    [sitesResponse, extensionsData, lifecycleLoad.data]
  )
  const allTenants = useMemo(() => buildTenants(data), [data])
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
  // Today's badge counts the queue itself. It used to count fixture registrations,
  // a number with no relation to what the screen shows.
  const queueCount = useMemo(
    () => buildQueue({
      grants: extensionsData.grants,
      openRequests: extensionsLoad.openRequests,
      today: extensionsData.today
    }).rows.length,
    [extensionsData.grants, extensionsData.today, extensionsLoad.openRequests]
  )

  const navCounts = useMemo<Record<Screen, number>>(() => ({
    today: queueCount,
    sites: allSites.length,
    extensions: extensionsData.grants.length,
    automation: extensionsData.grants.reduce((total, grant) => total + (grant.actionAudit?.length ?? 0), 0)
  }), [allSites.length, extensionsData.grants, queueCount])

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
  /**
   * Action ids the open case will actually run. A blocked action renders no
   * control at all, so a dispatch carrying one did not come from the drawer;
   * the guard keeps the rule in the store rather than in the rendering layer.
   */
  const runnableIds = useMemo(() => {
    if (!selectedEvent || !detail) return new Set<string>()
    const { next, more } = buildActions(detail, selectedEvent.id, state.confirming, state.done)
    const usable = [next, ...more].filter(item => item.id && !item.blocked && !item.held)
    return new Set(usable.map(item => item.id))
  }, [detail, selectedEvent, state.confirming, state.done])

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
  const openQueue = useCallback((row: QueueRow) => dispatch({ type: 'openQueue', row }), [])
  const openExtension = useCallback((domain: string) => {
    const event = latestGrantEventForDomain(events, domain)
    if (event) dispatch({ type: 'open', id: event.id })
  }, [events])
  const close = useCallback(() => dispatch({ type: 'close' }), [])
  const cancel = useCallback(() => dispatch({ type: 'cancel' }), [])
  const run = useCallback(
    (key: string, needsConfirm: boolean) => {
      if (!isKeyForSelected(state.selected, key) || !runnableIds.has(key)) return
      dispatch({
        type: 'run',
        key,
        needsConfirm,
        stamp: stampNow(data.operator)
      })
    },
    [data.operator, runnableIds, state.selected]
  )
  const confirmRun = useCallback(
    (key: string) => {
      if (!isKeyForSelected(state.selected, key) || !runnableIds.has(key)) return
      dispatch({ type: 'confirm', key, stamp: stampNow(data.operator) })
    },
    [data.operator, runnableIds, state.selected]
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
      rules,
      navCounts,
      selectedEvent,
      selectedQueueRow: state.selectedQueueRow,
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
      openQueue,
      openExtension,
      close,
      run,
      confirmRun,
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
      rules,
      navCounts,
      selectedEvent,
      state.selectedQueueRow,
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
      openQueue,
      openExtension,
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
