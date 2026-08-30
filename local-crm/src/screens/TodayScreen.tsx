import Chip from '@/components/Chip'
import EventCard from '@/components/EventCard'
import SectionLabel from '@/components/SectionLabel'
import { todayGrantMode } from '@/data/todayApi'
import { count, requestedLabel } from '@/lib/format'
import { PRODUCT } from '@/lib/palette'
import { useCrmStore } from '@/stores/crm'
import type { FeedFilter } from '@/lib/derive'

const FILTERS: Array<{ key: FeedFilter; label: string }> = [
  { key: 'all', label: 'everything' },
  { key: 'registered', label: 'registrations' },
  { key: 'granted', label: 'grants' },
  { key: 'expired', label: 'expiries' }
]

export default function TodayScreen() {
  const {
    data,
    filter,
    setFilter,
    feed,
    counts,
    scheduled,
    open,
    query,
    extensionsLoad,
    lifecycleLoad
  } = useCrmStore()
  const grantMode = todayGrantMode(extensionsLoad)
  const openRequests = extensionsLoad.openRequests
  const withoutCurrentGrant = openRequests?.rows.filter(row => row.currentGrant === 'not_observed') ?? []
  const sourceLabels = {
    marketplace: 'Marketplace',
    jsm: 'JSM',
    space_license_kv: 'grant KV',
    extension_action_d1: 'action D1'
  } as const
  const maxStepCount = Math.max(
    1,
    ...(lifecycleLoad.data
      ? ['lite', 'full', 'dia', 'api'].map(app => lifecycleLoad.data?.contacts.filter(contact => contact.app === app).length ?? 0)
      : data.steps.map(step => step.welcome + step.lapsed))
  )
  const lifecycleByApp = ['lite', 'full', 'dia', 'api'].map(app => ({
    app: app as keyof typeof PRODUCT,
    contacts: lifecycleLoad.data?.contacts.filter(contact => contact.app === app) ?? [],
  }))
  const lifecycleGaps = [
    'Registration event history is not available from the Marketplace export; the local first_seen_at value is only this machine’s bootstrap observation.',
    'No sender-run, delivery, bounce, unsubscribe, or recipient engagement source is connected; email previews are read-only.',
    'No assignment, Site Contact, or per-contact eligibility store is connected; the console does not infer any of those states.'
  ]

  return (
    <div className="px-6 pb-7 pt-5">
      <section
        data-testid="today-grant-source-status"
        data-grant-mode={grantMode}
        className={`mb-5 rounded-lg border px-4 py-3 ${
          grantMode === 'live'
            ? 'border-[color:var(--color-success)] bg-bg1'
            : grantMode === 'partial'
              ? 'border-[color:var(--accent-drawio-500)] bg-bg1'
              : grantMode === 'unavailable'
                ? 'border-[color:var(--color-danger)] bg-bg1'
                : 'border-line bg-bg1'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-[760px]">
            <div className="text-body-sm font-semibold">
              {grantMode === 'live'
                ? 'Live grant and expiry rows'
                : grantMode === 'partial'
                  ? 'Partial live grant and expiry rows'
                  : grantMode === 'unavailable'
                    ? 'Grant and expiry rows unavailable'
                    : 'Loading live grant and expiry rows…'}
            </div>
            <div className="mt-1 text-micro leading-6 text-fg2">
              {grantMode === 'live' || grantMode === 'partial'
                ? `Current grant records come from SPACE_LICENSE_KV${extensionsLoad.generatedAt ? `, read ${new Date(extensionsLoad.generatedAt).toLocaleString()}` : ''}. Expiry rows are derived from current expiresAt; they are not stored expiry history.${grantMode === 'partial' ? ' Some context or timestamp evidence remains explicitly unavailable.' : ''}`
                : grantMode === 'unavailable'
                  ? `${extensionsLoad.error ?? 'The authoritative grant KV read is unavailable.'} No sanitized grant or expiry rows are substituted.`
                  : 'The authoritative grant KV read is in progress. No sanitized grant or expiry rows are substituted.'}
            </div>
            <div
              data-testid="today-fixture-notice"
              className="mt-1 text-micro leading-6 text-fg3"
            >
              Registration event history is unavailable: the local Marketplace ingest proves current contacts, not when an installation was registered. No synthetic registration rows are shown.
            </div>
          </div>
          {extensionsLoad.sources ? (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(extensionsLoad.sources).map(([key, source]) => (
                <span
                  key={key}
                  data-testid={`today-source-${key}`}
                  className="rounded-full border border-line bg-bg2 px-2 py-1 font-mono text-micro text-fg2"
                >
                  {sourceLabels[key as keyof typeof sourceLabels]} · {source.records} · {source.state}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>
      <section
        data-testid="today-open-jsm-requests"
        className="mb-5 rounded-lg border border-line bg-bg1 px-4 py-3"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-[760px]">
            <SectionLabel>Open JSM extension requests</SectionLabel>
            <div className="mt-1 text-micro leading-6 text-fg2">
              {openRequests
                ? openRequests.detail
                : 'Waiting for the shared JSM and current grant KV snapshot. No fixture requests are shown.'}
            </div>
          </div>
          {openRequests ? (
            <div className="flex flex-wrap gap-1.5 font-mono text-micro text-fg2">
              {openRequests.state === 'truncated' ? (
                <span className="rounded-full border border-rust-100 bg-bg2 px-2 py-1 text-rust-800">fetched subset</span>
              ) : null}
              <span className="rounded-full border border-line bg-bg2 px-2 py-1">
                {count(openRequests.summary.currentGrantObserved)} current grant observed
              </span>
              <span className="rounded-full border border-rust-100 bg-bg2 px-2 py-1 text-rust-800">
                {count(openRequests.summary.noCurrentGrantObserved)} no current grant observed
              </span>
              <span className="rounded-full border border-line bg-bg2 px-2 py-1">
                {count(openRequests.summary.insufficientEvidence)} insufficient evidence
              </span>
            </div>
          ) : null}
        </div>
        {openRequests?.state === 'unavailable' ? (
          <div className="mt-3 text-micro leading-6 text-fg3">
            No request rows are asserted while either JSM or the current grant KV is unavailable.
          </div>
        ) : withoutCurrentGrant.length ? (
          <div className="mt-3 flex flex-col gap-2">
            {withoutCurrentGrant.map(row => (
              <div key={row.ticketKey} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-rust-100 bg-bg2 px-3 py-2">
                <span className="font-mono text-body-sm font-semibold">{row.ticketKey}</span>
                <span className="rounded-full border border-rust-100 px-2 py-0.5 font-mono text-micro text-rust-800">
                  no current grant observed
                </span>
                <span className="text-micro text-fg2">{row.status ?? 'status unavailable'}</span>
                <span className="text-micro text-fg3">
                  {requestedLabel(row.createdAt) ? `requested ${requestedLabel(row.createdAt)}` : 'request date unavailable'}
                </span>
              </div>
            ))}
          </div>
        ) : openRequests ? (
          <div className="mt-3 text-micro leading-6 text-fg3">
            No fetched open JSM requests lack an exact recorded current-grant ticket match.
          </div>
        ) : null}
        <div className="mt-2 text-micro leading-6 text-fg3">
          “No current grant observed” is not a rejected, denied, or unprocessed verdict. Matching uses only the exact ticket recorded in a current KV grant’s <span className="font-mono">activatedBy</span> value.
        </div>
      </section>
      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-[520px] flex-1">
          <div
            className="sticky top-0 z-[6] -mx-6 -mt-5 mb-4 bg-bg2 px-6 pb-4 pt-5"
            data-testid="today-filter-bar"
          >
            <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
              <h3 className="text-h3 font-semibold">Known activity stream</h3>
              <span className="text-body-sm text-fg2">
                current grant records + derived expiries · latest known dates first
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {FILTERS.map(item => {
                const active = item.key === filter
                return (
                  <button
                    key={item.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(item.key)}
                    className={`lc-t-bg h-7 cursor-pointer rounded-full border px-[11px] font-mono text-[12px] ${
                      active
                        ? 'border-fg1 bg-fg1 text-white'
                        : 'border-line bg-bg1 text-fg2 hover:border-line-strong'
                    }`}
                  >
                    {item.label} {count(counts[item.key])}
                  </button>
                )
              })}
            </div>
          </div>

          {feed.length ? (
            <div className="flex flex-col">
              {feed.map(day => (
                <div key={day.day} className="flex items-stretch gap-4">
                  <div className="w-[74px] shrink-0 pt-0.5 text-right">
                    <div className="whitespace-nowrap font-mono text-body-sm font-semibold text-fg1">
                      {day.date}
                    </div>
                    <div className="mt-0.5 whitespace-nowrap text-micro text-fg3">{day.rel}</div>
                  </div>
                  <div className="mt-1.5 w-px shrink-0 bg-line" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 pb-[18px]">
                    {day.events.map(event => (
                      <EventCard key={event.id} event={event} onOpen={() => open(event.id)} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-line bg-bg1 px-5 py-10 text-center text-body-sm text-fg2">
              {query.trim()
                ? `No events match “${query.trim()}”.`
                : `No ${FILTERS.find(item => item.key === filter)?.label ?? 'matching'} events in the past stream.`}
            </div>
          )}
        </div>

        <aside className="flex min-w-[320px] flex-1 flex-col gap-4">
          <section className="rounded-lg border border-line bg-bg1 p-4">
            <div className="mb-1">
              <SectionLabel>Current local contacts, by app</SectionLabel>
            </div>
            <div className="mb-3 text-micro text-fg2">
              current Marketplace bootstrap inventory · not acquisition history
            </div>
            <div className="flex flex-col gap-[11px]">
              {lifecycleByApp.map(row => {
                const product = PRODUCT[row.app]
                return (
                  <div key={row.app} className="flex items-baseline gap-2.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: product.color }}
                    />
                    <span className="flex-1 font-mono text-[12px]">{product.name}</span>
                    <span className="lc-num text-body font-semibold">{count(row.contacts.length)}</span>
                    <span className="whitespace-nowrap text-micro text-fg2">bootstrap-suppressed</span>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 border-t border-bg3 pt-2.5 font-mono text-micro leading-6 text-fg3">
              {lifecycleLoad.data ? `${count(lifecycleLoad.data.source.marketplaceRows)} Marketplace rows · local SQLite` : 'local contact source loading'}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-bg1 p-4">
            <div className="mb-1">
              <SectionLabel>Ingested contacts</SectionLabel>
            </div>
            <div className="mb-3 text-micro text-fg2">
              {lifecycleLoad.data ? `${count(lifecycleLoad.data.summary.contacts)} source-backed rows · all bootstrap-suppressed` : 'local contact source loading'}
            </div>
            <div className="flex flex-col gap-[9px]">
              {lifecycleByApp.map(step => {
                const product = PRODUCT[step.app]
                const welcome = step.contacts.filter(contact => contact.step === 'welcome').length
                const lapsed = step.contacts.filter(contact => contact.step === 'lapsed').length
                const welcomeWidth = `${(welcome / maxStepCount) * 100}%`
                const lapsedWidth = `${(lapsed / maxStepCount) * 100}%`
                return (
                  <div key={step.app}>
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="flex-1 font-mono text-[12px]">{product.name}</span>
                      <span className="lc-num font-mono text-micro text-fg2">
                        {count(welcome)} welcome · {count(lapsed)} lapsed
                      </span>
                    </div>
                    <div className="flex h-[5px] overflow-hidden rounded-full bg-bg3">
                      <div style={{ width: welcomeWidth, background: product.color }} />
                      <div className="bg-gray-300" style={{ width: lapsedWidth }} />
                    </div>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 border-t border-bg3 pt-2.5 text-micro leading-6 text-fg3">
              Solid is <span className="font-mono">welcome</span>, grey is{' '}
              <span className="font-mono">lapsed</span>. Every{' '}
              <span className="font-mono">first_seen_at</span> is a local bootstrap timestamp,
              not an acquisition date.
            </div>
          </section>

          <section className="rounded-lg border border-rust-100 bg-bg1 p-4">
            <div className="mb-2.5">
              <SectionLabel className="!text-rust-800">No data source yet</SectionLabel>
            </div>
            <div className="flex flex-col gap-[9px]">
              {lifecycleGaps.map(gap => (
                <div key={gap} className="flex items-start gap-[9px]">
                  <span className="mt-1.5 size-[5px] shrink-0 rounded-full bg-rust-500" />
                  <div className="text-micro leading-6 text-fg2">{gap}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-bg1 p-4">
            <div className="mb-1 flex items-baseline justify-between gap-3">
              <SectionLabel>Scheduled</SectionLabel>
              <span className="lc-num font-mono text-micro text-fg3">
                {count(scheduled.total)} scheduled
              </span>
            </div>
            <div className="text-micro text-fg2">
              {grantMode === 'live' || grantMode === 'partial'
                ? 'live KV expiresAt · derived, not stored history'
                : grantMode === 'loading'
                  ? 'waiting for the authoritative grant KV read'
                  : 'authoritative grant KV unavailable'}
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {scheduled.head.map(item => (
                <div key={`${item.date}:${item.what}`} className="flex flex-wrap items-baseline gap-2.5">
                  <span className="size-[9px] shrink-0 rounded-full border-2 border-gray-400 bg-bg1" />
                  <span className="whitespace-nowrap font-mono text-body-sm font-medium">
                    {item.date}
                  </span>
                  <span className="whitespace-nowrap text-micro text-fg3">{item.rel}</span>
                  <span className="text-body-sm text-fg2 [overflow-wrap:anywhere]">{item.what}</span>
                </div>
              ))}
              {!scheduled.head.length ? (
                <div className="text-micro leading-6 text-fg3">
                  No source-backed scheduled expiries are available.
                </div>
              ) : null}
            </div>
            {scheduled.rest ? (
              <div className="mt-3 border-t border-bg3 pt-2.5 text-micro leading-6 text-fg3">
                {scheduled.rest}
              </div>
            ) : null}
          </section>
        </aside>
      </div>
    </div>
  )
}
