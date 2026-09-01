import Chip from '@/components/Chip'
import { count } from '@/lib/format'
import { ORIGIN_ACCENT } from '@/lib/palette'
import { useCrmStore } from '@/stores/crm'

const GRID =
  'grid min-w-[706px] grid-cols-[minmax(160px,1.5fr)_76px_76px_minmax(180px,1.4fr)_minmax(140px,1.1fr)] gap-2'

export default function ExtensionsScreen() {
  const { data, tenants, query, extensionsLoad, openExtension } = useCrmStore()
  const needle = query.trim().toLowerCase()
  const origins = data.origins.filter(origin => {
    if (!needle) return true
    return [origin.label, origin.note, origin.pattern, String(origin.n)].some(value =>
      value.toLowerCase().includes(needle)
    )
  })
  const tenantTotal = extensionsLoad.summary?.tenantCount
    ?? new Set(data.grants.map(grant => grant.domain)).size
  const sourceLabels = {
    marketplace: 'Marketplace',
    jsm: 'JSM',
    space_license_kv: 'grant KV',
    extension_action_d1: 'action D1'
  } as const
  const liveSummary = extensionsLoad.summary
    ? [
        `${count(extensionsLoad.summary.activeCount)} active`,
        `${count(extensionsLoad.summary.inactiveCount)} inactive`,
        `${count(extensionsLoad.summary.expiredCount)} expired`,
        `${count(extensionsLoad.summary.unknownStatusCount)} unknown`,
        extensionsLoad.sources?.jsm.state === 'error'
          ? 'JSM correlation unavailable'
          : `${count(extensionsLoad.summary.matchedRequestCount)} correlated to JSM`,
        extensionsLoad.sources?.extension_action_d1.state === 'error'
          ? 'ExtensionAction audit unavailable'
          : `${count(extensionsLoad.summary.auditedGrantCount)} backed by ExtensionAction rows`
      ].join(' · ')
    : null

  return (
    <div className="flex flex-col gap-6 px-6 pb-7 pt-5">
      <section
        data-testid="extensions-source-status"
        className={`rounded-lg border px-4 py-3 ${
          extensionsLoad.state === 'live'
            ? 'border-[color:var(--color-success)] bg-bg1'
            : extensionsLoad.state === 'error'
              ? 'border-[color:var(--color-danger)] bg-bg1'
              : extensionsLoad.state === 'partial'
                ? 'border-[color:var(--accent-drawio-500)] bg-bg1'
                : 'border-line bg-bg1'
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-body-sm font-semibold">
              {extensionsLoad.state === 'live'
                ? 'Live extension data'
                : extensionsLoad.state === 'error'
                  ? 'Sanitized extension fixture — live load failed'
                  : extensionsLoad.state === 'partial'
                    ? 'Partial live extension data'
                    : 'Loading live extension data…'}
            </div>
            <div className="mt-1 text-micro text-fg2">
              {(extensionsLoad.state === 'live' || extensionsLoad.state === 'partial') && extensionsLoad.generatedAt
                ? `Read ${new Date(extensionsLoad.generatedAt).toLocaleString()}; API responses are not cached by the browser.${extensionsLoad.incompleteGrantCount ? ` ${extensionsLoad.incompleteGrantCount} grant ${extensionsLoad.incompleteGrantCount === 1 ? 'has' : 'have'} missing timestamp evidence and remain visible as unknown.` : ''}`
                : extensionsLoad.error ?? 'The fixture remains visible until the loopback API returns.'}
            </div>
          </div>
          {extensionsLoad.sources ? (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(extensionsLoad.sources).map(([key, source]) => (
                <span
                  key={key}
                  data-testid={`extension-source-${key}`}
                  className="rounded-full border border-line bg-bg2 px-2 py-1 font-mono text-micro text-fg2"
                >
                  {sourceLabels[key as keyof typeof sourceLabels]} · {source.records} · {source.state}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
          <h3 className="text-h3 font-semibold">Grant records by tenant</h3>
          <span className="text-body-sm text-fg2">
            {count(data.grants.length)} grants across {count(tenantTotal)} tenants · highest grant count first
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
              <button
                type="button"
                key={tenant.domain}
                onClick={() => openExtension(tenant.domain)}
                disabled={extensionsLoad.state === 'loading'}
                aria-label={`Open latest extension case for ${tenant.domain}`}
                className={`${GRID} lc-t-bg w-full items-center border-b border-bg3 bg-bg1 px-[18px] py-3.5 text-left last:border-b-0 enabled:cursor-pointer enabled:hover:bg-bg2 disabled:cursor-wait disabled:opacity-60`}
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
              </button>
            ))
          ) : (
            <div className="min-w-[706px] px-[18px] py-10 text-center text-body-sm text-fg2">
              {query.trim()
                ? `No extension tenants match “${query.trim()}”.`
                : 'No extension tenants are on file.'}
            </div>
          )}
        </div>
        <div data-testid="extensions-live-summary" className="mt-2 text-micro leading-6 text-fg3">
          {liveSummary
            ? `${liveSummary}.`
            : 'Aggregate interpretation is withheld until the live source response is available.'}
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
