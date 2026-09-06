import { human } from '@/lib/format'
import { useCrmStore } from '@/stores/crm'

export default function TopBar() {
  const store = useCrmStore()
  const active = store.data.grants.filter(grant => grant.active).length
  const screenCopy = {
    today: [
      'Today',
      `${new Intl.DateTimeFormat('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(new Date(`${store.data.today}T00:00:00Z`))} · one stream of registrations, grants and expiries`
    ],
    sites: [
      'Sites',
      `${store.navCounts.sites} clients · ${store.data.registrations.length} new this month, ${new Set(
        store.data.grants.map(grant => grant.domain)
      ).size} holding an editing extension`
    ],
    extensions: [
      'Extension requests',
      `${store.data.grants.length} live grants · ${active} still active on ${human(store.data.today)}`
    ],
    pending: [
      'Pending assignment',
      `${store.navCounts.pending} grants whose cloud ID matches nothing in the licence export`
    ],
    automation: [
      'Automation',
      `${store.data.rules.length} mechanisms · one live, two running by hand, five not wired up`
    ]
  } as const
  const [title, subtitle] = screenCopy[store.screen]

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
        <span className="size-[6px] rounded-full bg-ok" />
        {store.data.marketplace.freshness}
      </div>
    </header>
  )
}
