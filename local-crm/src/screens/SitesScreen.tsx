import Chip from '@/components/Chip'
import { count } from '@/lib/format'
import { PRODUCT } from '@/lib/palette'
import { useCrmStore } from '@/stores/crm'
import type { SiteStat } from '@/lib/derive'
import { MARKETPLACE_TECHNICAL_CONTACT_LABEL } from '@/data/sitesApi'

const GRID =
  'grid min-w-[880px] grid-cols-[minmax(170px,1.45fr)_96px_minmax(110px,0.8fr)_minmax(150px,1.1fr)_minmax(180px,1.2fr)_100px] gap-2'

function statColor(tone: SiteStat['tone']): string {
  if (tone === 'brand') return 'var(--color-primary)'
  if (tone === 'rust') return 'var(--accent-plantuml-500)'
  return 'var(--fg1)'
}

export default function SitesScreen() {
  const { sites, siteStats, query, sitesLoad, lifecycleLoad } = useCrmStore()

  return (
    <div className="px-6 pb-7 pt-5">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
        <h3 className="text-h3 font-semibold">Every site we hold context for</h3>
        <span className="text-body-sm text-fg2">
          source-backed from the Marketplace licence export — a domain is display information, never an identity key
        </span>
      </div>

      {sitesLoad.state === 'live' && sitesLoad.summary ? (
        <div className="mb-2 rounded-md border border-line bg-bg2 px-3.5 py-2 text-micro text-fg2">
          Marketplace source · {sitesLoad.summary.licenseCount} licence rows · read {sitesLoad.generatedAt ? new Date(sitesLoad.generatedAt).toLocaleString() : 'now'}
        </div>
      ) : (
        <div className="mb-2 rounded-md border border-dashed border-line bg-bg2 px-3.5 py-2 text-micro text-fg2">
          {sitesLoad.state === 'error' ? `${sitesLoad.error ?? 'Marketplace source unavailable'}. No sanitized site rows are substituted.` : 'Marketplace source is loading. No sanitized site rows are substituted.'}
        </div>
      )}
      <div className="mb-3 flex flex-wrap gap-px overflow-hidden rounded-md border border-line bg-line">
        {siteStats.map(stat => (
          <div key={stat.label} className="min-w-[120px] flex-1 bg-bg1 px-3.5 py-2.5">
            <div
              className="lc-num text-[18px] font-bold leading-[1.2]"
              style={{ color: statColor(stat.tone) }}
            >
              {count(stat.value)}
            </div>
            <div className="mt-0.5 text-micro text-fg2">{stat.label}</div>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-bg1">
        <div className={`${GRID} border-b border-line bg-bg2 px-[18px] py-[9px]`}>
          {['Client', 'Cloud ID', 'Apps', 'Extensions', MARKETPLACE_TECHNICAL_CONTACT_LABEL, 'Source'].map(label => (
            <div key={label} className="lc-label whitespace-nowrap">
              {label}
            </div>
          ))}
        </div>
        {sites.length ? (
          sites.map(site => (
            <div
              key={site.cloudId}
              className={`${GRID} lc-t-bg items-center border-b border-bg3 bg-bg1 px-[18px] py-3.5 last:border-b-0 hover:bg-bg2`}
            >
              <div
                title={site.domain}
                className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-body-sm font-medium"
              >
                {site.domain}
              </div>
              <div
                title={site.cloudId}
                className={`overflow-hidden text-ellipsis whitespace-nowrap font-mono text-micro ${
                  site.cloudIdMissing ? 'text-bad' : 'text-fg2'
                }`}
              >
                {site.cloudId}
              </div>
              <div className="flex flex-wrap gap-1">
                {site.apps.map(app => (
                  <Chip key={app} tone={PRODUCT[app].chip}>
                    {PRODUCT[app].name}
                  </Chip>
                ))}
              </div>
              <div
                title={site.extensions}
                className="overflow-hidden text-ellipsis whitespace-nowrap text-micro text-fg2"
              >
                {site.extensions}
              </div>
              <div className="min-w-0 break-words text-micro text-fg2" title={site.technicalContacts.join(', ')}>
                {lifecycleLoad.state === 'live'
                  ? (site.technicalContacts.length ? site.technicalContacts.join(', ') : '—')
                  : lifecycleLoad.state === 'error' ? 'local contact source unavailable' : 'local contacts loading'}
              </div>
              <div className="whitespace-nowrap font-mono text-micro text-fg3">{site.last}</div>
            </div>
          ))
        ) : (
          <div className="min-w-[880px] px-[18px] py-10 text-center text-body-sm text-fg2">
            {query.trim() ? `No sites match “${query.trim()}”.` : sitesLoad.state === 'loading' ? 'Loading Marketplace sites…' : 'No Marketplace sites are available.'}
          </div>
        )}
      </div>

      <div className="mt-2 text-micro leading-6 text-fg3">
        Marketplace is authoritative for this inventory. Current editing grants are joined by cloud ID;
        grant-only tenants with no Marketplace row are kept out of site inventory instead of being invented as sites. Technical contacts are current Marketplace export records joined by cloud ID, not confirmed Site Contacts.
      </div>
    </div>
  )
}
