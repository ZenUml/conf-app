import Chip from '@/components/Chip'
import { count } from '@/lib/format'
import { ORIGIN_ACCENT } from '@/lib/palette'
import { useCrmStore } from '@/stores/crm'

const GRID =
  'grid min-w-[706px] grid-cols-[minmax(160px,1.5fr)_76px_76px_minmax(180px,1.4fr)_minmax(140px,1.1fr)] gap-2'

export default function ExtensionsScreen() {
  const { data, tenants, query } = useCrmStore()
  const needle = query.trim().toLowerCase()
  const origins = data.origins.filter(origin => {
    if (!needle) return true
    return [origin.label, origin.note, origin.pattern, String(origin.n)].some(value =>
      value.toLowerCase().includes(needle)
    )
  })
  const tenantTotal = new Set(data.grants.map(grant => grant.domain)).size

  return (
    <div className="flex flex-col gap-6 px-6 pb-7 pt-5">
      <section>
        <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
          <h3 className="text-h3 font-semibold">Who keeps asking</h3>
          <span className="text-body-sm text-fg2">
            {count(data.grants.length)} grants across {count(tenantTotal)} tenants · repeat requests first
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-line bg-bg1">
          <div className={`${GRID} border-b border-line bg-bg2 px-[18px] py-[9px]`}>
            {['Client', 'Grants', 'Active', 'Spaces', 'Window'].map(label => (
              <div key={label} className="lc-label whitespace-nowrap">
                {label}
              </div>
            ))}
          </div>
          {tenants.length ? (
            tenants.map(tenant => (
              <div
                key={tenant.domain}
                className={`${GRID} lc-t-bg items-center border-b border-bg3 bg-bg1 px-[18px] py-3.5 last:border-b-0 hover:bg-bg2`}
              >
                <div
                  title={tenant.domain}
                  className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-body-sm font-medium"
                >
                  {tenant.domain}
                </div>
                <div className="lc-num text-body font-semibold">{count(tenant.grants)}</div>
                <div>
                  <Chip tone={tenant.hasActive ? 'sent' : 'skipped'}>{tenant.active}</Chip>
                </div>
                <div
                  title={tenant.spaces}
                  className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-micro text-fg2"
                >
                  {tenant.spaces}
                </div>
                <div
                  title={tenant.window}
                  className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-micro text-fg3"
                >
                  {tenant.window}
                </div>
              </div>
            ))
          ) : (
            <div className="min-w-[706px] px-[18px] py-10 text-center text-body-sm text-fg2">
              {query.trim()
                ? `No extension tenants match “${query.trim()}”.`
                : 'No extension tenants are on file.'}
            </div>
          )}
        </div>
        <div className="mt-2 text-micro leading-6 text-fg3">
          Nine of the {count(data.grants.length)} grants belong to one tenant across six spaces, five
          of them issued on a single day by an A/B experiment rather than a support ticket. Three
          tenants account for 16 of the {count(data.grants.length)}.
        </div>
      </section>

      <section>
        <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
          <h3 className="text-h3 font-semibold">Where grants come from</h3>
          <span className="text-body-sm text-fg2">
            read out of the <span className="font-mono text-[12px]">activatedBy</span> field
          </span>
        </div>
        {origins.length ? (
          <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-3">
            {origins.map(origin => (
              <article
                key={origin.label}
                className="rounded-lg border border-line border-l-[3px] bg-bg1 px-4 py-3.5"
                style={{ borderLeftColor: ORIGIN_ACCENT[origin.accent] }}
              >
                <div className="flex items-baseline gap-2.5">
                  <span className="lc-num text-[20px] font-bold leading-none">{count(origin.n)}</span>
                  <span className="flex-1 text-body-sm font-medium">{origin.label}</span>
                </div>
                <div className="mt-[7px] text-micro leading-6 text-fg2">{origin.note}</div>
                <div className="mt-[7px] font-mono text-micro text-fg3 [overflow-wrap:anywhere]">
                  {origin.pattern}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-bg1 px-5 py-10 text-center text-body-sm text-fg2">
            No grant origins match “{query.trim()}”.
          </div>
        )}
      </section>
    </div>
  )
}
