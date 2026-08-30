import { human } from '@/lib/format'
import { grantStatusOf } from '@/lib/lifecycle'
import { todayGrantMode } from '@/data/todayApi'
import { pendingGrantMode } from '@/data/pendingApi'
import { useCrmStore } from '@/stores/crm'

export default function TopBar() {
  const store = useCrmStore()
  const active = store.data.grants.filter(grant => grantStatusOf(grant) === 'active').length
  const extensionTenantCount = new Set(
    store.data.grants.map(grant => grant.cloudId ?? grant.domain)
  ).size
  const todayMode = todayGrantMode(store.extensionsLoad)
  const pendingMode = pendingGrantMode(store.extensionsLoad)
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
          ? `${store.data.grants.length} source-backed grant records · registrations sanitized`
          : todayMode === 'partial'
            ? `${store.data.grants.length} partial source-backed grant records · registrations sanitized`
            : todayMode === 'unavailable'
              ? 'grant and expiry rows unavailable · registrations sanitized'
              : 'loading grant and expiry rows · registrations sanitized'
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
        : `${store.data.grants.length} sanitized fixture grants · live source ${store.extensionsLoad.state}`
    ],
    pending: [
      'Pending assignment',
      pendingMode === 'live' || pendingMode === 'partial'
        ? `${store.navCounts.pending} source-backed grants need site-mapping evidence review${pendingMode === 'partial' ? ' · evidence partial' : ''}`
        : pendingMode === 'loading'
          ? 'loading source-backed mapping evidence · no fixture queue substituted'
          : 'mapping evidence unavailable · no fixture queue substituted'
    ],
    automation: [
      'Automation',
      store.extensionsLoad.sources?.extension_action_d1.state === 'ok'
        ? `${store.navCounts.automation} observed ExtensionAction audit rows · read-only`
        : store.extensionsLoad.state === 'loading'
          ? 'loading ExtensionAction audit · no fixture automation rows substituted'
          : 'ExtensionAction audit unavailable · no fixture automation rows substituted'
    ]
  } as const
  const [title, subtitle] = screenCopy[store.screen]
  const extensionFreshness = (store.extensionsLoad.state === 'live' || store.extensionsLoad.state === 'partial') && store.extensionsLoad.generatedAt
    ? `Extensions API ${store.extensionsLoad.state === 'partial' ? 'partial · ' : ''}${new Date(store.extensionsLoad.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : `Extensions ${store.extensionsLoad.state}`
  const usesExtensionFreshness = store.screen === 'extensions' || store.screen === 'today' || store.screen === 'pending' || store.screen === 'automation'
  const sitesFreshness = store.sitesLoad.state === 'live' && store.sitesLoad.generatedAt
    ? `Marketplace ${new Date(store.sitesLoad.generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : `Marketplace ${store.sitesLoad.state}`
  const freshness = store.screen === 'sites' ? sitesFreshness : extensionFreshness

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
