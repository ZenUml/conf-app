import { human } from '@/lib/format'
import { grantStatusOf } from '@/lib/lifecycle'
import { todayGrantMode } from '@/data/todayApi'
import type { ExtensionsLoadState } from '@/data/extensionsApi'
import { useCrmStore } from '@/stores/crm'

export function automationStatus(
  load: ExtensionsLoadState,
  auditedCount: number
): readonly [subtitle: string, freshness: string] {
  const d1 = load.sources?.extension_action_d1
  const subtitle = d1?.state === 'ok'
    ? `${auditedCount} observed ExtensionAction audit rows · read-only`
    : load.state === 'loading'
      ? 'loading ExtensionAction audit · no fixture automation rows substituted'
      : 'ExtensionAction audit unavailable · no fixture automation rows substituted'
  const freshness = d1?.state === 'ok' && load.generatedAt
    ? `ExtensionAction ${new Date(load.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : `ExtensionAction ${d1?.state ?? load.state}`
  return [subtitle, freshness]
}

export default function TopBar() {
  const store = useCrmStore()
  const active = store.data.grants.filter(grant => grantStatusOf(grant) === 'active').length
  const extensionTenantCount = new Set(
    store.data.grants.map(grant => grant.cloudId ?? grant.domain)
  ).size
  const todayMode = todayGrantMode(store.extensionsLoad)
  const [automationSubtitle, automationFreshness] = automationStatus(
    store.extensionsLoad,
    store.navCounts.automation
  )
  const screenCopy = {
    today: [
      'Today',
      `${new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(new Date(`${store.data.today}T00:00:00Z`))} · ${
        todayMode === 'live'
          ? `${store.data.grants.length} source-backed grant records · registration history unavailable`
          : todayMode === 'partial'
            ? `${store.data.grants.length} partial source-backed grant records · registration history unavailable`
            : todayMode === 'unavailable'
              ? 'grant and expiry rows unavailable · registration history unavailable'
              : 'loading grant and expiry rows · registration history unavailable'
      }`
    ],
    sites: [
      'Sites',
      store.sitesLoad.state === 'live' && store.sitesLoad.summary
        ? `${store.navCounts.sites} Marketplace sites · ${store.sitesLoad.summary.licenseCount} licence rows · ${new Set(
          store.data.grants.map(grant => grant.cloudId ?? grant.domain)
        ).size} holding an editing extension`
        : store.sitesLoad.state === 'loading'
          ? 'loading Marketplace inventory · no fixture sites substituted'
          : 'Marketplace inventory unavailable · no fixture sites substituted'
    ],
    extensions: [
      'Editing extensions',
      store.extensionsLoad.state === 'live' || store.extensionsLoad.state === 'partial'
        ? `${store.data.grants.length} ${store.extensionsLoad.state === 'partial' ? 'partially ' : ''}source-backed grant records across ${extensionTenantCount} tenants · ${active} active on ${human(store.data.today)}`
        : store.data.placeholder
          ? `${store.data.grants.length} explicit synthetic fixture grants · not production freshness · live source ${store.extensionsLoad.state}`
          : `${store.data.grants.length} local dataset grants · live source ${store.extensionsLoad.state}`
    ],
    automation: [
      'Automation',
      automationSubtitle
    ]
  } as const
  const [title, subtitle] = screenCopy[store.screen]
  const extensionFreshness = (store.extensionsLoad.state === 'live' || store.extensionsLoad.state === 'partial') && store.extensionsLoad.generatedAt
    ? `Extensions API ${store.extensionsLoad.state === 'partial' ? 'partial · ' : ''}${new Date(store.extensionsLoad.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : `Extensions ${store.extensionsLoad.state}`
  const sitesFreshness = store.sitesLoad.state === 'live' && store.sitesLoad.generatedAt
    ? `Marketplace ${new Date(store.sitesLoad.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : `Marketplace ${store.sitesLoad.state}`
  const freshness = store.screen === 'sites' ? sitesFreshness : store.screen === 'automation' ? automationFreshness : extensionFreshness
  const usesExtensionFreshness = store.screen === 'today' || store.screen === 'extensions'

  return (
    <header className="flex h-[60px] shrink-0 items-center gap-4 border-b border-line bg-bg1 px-6">
      <div className="flex min-w-0 flex-col gap-px">
        <h1 className="truncate text-h4 font-semibold">{title}</h1>
        <div className="truncate text-micro text-fg2">{subtitle}</div>
      </div>
      <div className="flex-1" />
      <label className="relative w-[280px] max-w-[34vw] shrink-0">
        <span className="sr-only">Search current screen</span>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--fg3)"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="pointer-events-none absolute left-[10px] top-[9px] size-4"
          aria-hidden="true"
        >
          <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
        <input
          value={store.query}
          onChange={event => store.setQuery(event.target.value)}
          placeholder="Search clients, cloud IDs, spaces…"
          className="h-[34px] w-full rounded-md border border-line bg-bg2 py-0 pl-8 pr-3 text-body-sm text-fg1 outline-none focus:border-blue-500 focus:bg-bg1"
        />
      </label>
      <div className="flex h-7 shrink-0 items-center gap-[6px] whitespace-nowrap rounded-full bg-bg3 px-[10px] text-micro text-fg2">
        <span className={`size-[6px] rounded-full ${
          usesExtensionFreshness && store.extensionsLoad.state === 'loading'
            ? 'bg-fg3'
            : usesExtensionFreshness && (store.extensionsLoad.state === 'error' || store.extensionsLoad.state === 'partial')
              ? 'bg-[color:var(--color-danger)]'
              : 'bg-ok'
        }`} />
        {freshness}
      </div>
    </header>
  )
}
