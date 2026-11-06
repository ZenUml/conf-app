import Chip from '@/components/Chip'
import EventCard from '@/components/EventCard'
import SectionLabel from '@/components/SectionLabel'
import { count } from '@/lib/format'
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
  const { data, filter, setFilter, feed, counts, scheduled, open, query } = useCrmStore()
  const maxStepCount = Math.max(
    1,
    ...data.steps.map(step => step.welcome + step.lapsed)
  )

  return (
    <div className="px-6 pb-7 pt-5">
      <div className="flex flex-wrap items-start gap-5">
        <div className="min-w-[520px] flex-1">
          <div
            className="sticky top-0 z-[6] -mx-6 -mt-5 mb-4 bg-bg2 px-6 pb-4 pt-5"
            data-testid="today-filter-bar"
          >
            <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
              <h3 className="text-h3 font-semibold">Everything that happened</h3>
              <span className="text-body-sm text-fg2">
                registrations, extension grants and expiries in one stream · newest first
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
              <SectionLabel>New this month, by app</SectionLabel>
            </div>
            <div className="mb-3 text-micro text-fg2">against the skill’s own baselines</div>
            <div className="flex flex-col gap-[11px]">
              {data.byApp.map(row => {
                const product = PRODUCT[row.app]
                return (
                  <div key={row.app} className="flex items-baseline gap-2.5">
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ background: product.color }}
                    />
                    <span className="flex-1 font-mono text-[12px]">{product.name}</span>
                    <span className="lc-num text-body font-semibold">{count(row.n)}</span>
                    <span
                      className={`whitespace-nowrap text-micro ${row.unverified ? 'text-bad' : 'text-fg2'}`}
                    >
                      {row.note}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="mt-3 border-t border-bg3 pt-2.5 font-mono text-micro leading-6 text-fg3">
              {count(data.marketplace.licences)} licences · {count(data.marketplace.transactions)} transactions
              <br />
              synced {data.marketplace.syncedOn} · vendor {data.marketplace.vendor}
            </div>
          </section>

          <section className="rounded-lg border border-line bg-bg1 p-4">
            <div className="mb-1">
              <SectionLabel>Ingested contacts</SectionLabel>
            </div>
            <div className="mb-3 text-micro text-fg2">
              {count(data.ingest.contactsWritten)} rows · all held as backlog
            </div>
            <div className="flex flex-col gap-[9px]">
              {data.steps.map(step => {
                const product = PRODUCT[step.app]
                const welcomeWidth = `${(step.welcome / maxStepCount) * 100}%`
                const lapsedWidth = `${(step.lapsed / maxStepCount) * 100}%`
                return (
                  <div key={step.app}>
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="flex-1 font-mono text-[12px]">{product.name}</span>
                      <span className="lc-num font-mono text-micro text-fg2">
                        {count(step.welcome)} welcome · {count(step.lapsed)} lapsed
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
              <span className="font-mono">first_seen_at</span> is 28 Aug — the bootstrap timestamp,
              not an acquisition date.
            </div>
          </section>

          <section className="rounded-lg border border-rust-100 bg-bg1 p-4">
            <div className="mb-2.5">
              <SectionLabel className="!text-rust-800">No data source yet</SectionLabel>
            </div>
            <div className="flex flex-col gap-[9px]">
              {data.gaps.map(gap => (
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
