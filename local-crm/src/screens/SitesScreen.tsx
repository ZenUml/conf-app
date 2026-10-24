import Chip from '@/components/Chip'
import { count } from '@/lib/format'
import { PRODUCT } from '@/lib/palette'
import { useCrmStore } from '@/stores/crm'
import type { SiteStat } from '@/lib/derive'

const GRID =
  'grid min-w-[696px] grid-cols-[minmax(170px,1.6fr)_96px_minmax(110px,0.9fr)_minmax(150px,1.2fr)_100px] gap-2'

function statColor(tone: SiteStat['tone']): string {
  if (tone === 'brand') return 'var(--color-primary)'
  if (tone === 'rust') return 'var(--accent-plantuml-500)'
  return 'var(--fg1)'
}

export default function SitesScreen() {
  const { sites, siteStats, query } = useCrmStore()

  return (
    <div className="px-6 pb-7 pt-5">
      <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
        <h3 className="text-h3 font-semibold">Every site we hold context for</h3>
        <span className="text-body-sm text-fg2">
          grouped by cloud ID where one is known — a domain is display information, never an identity key
        </span>
      </div>

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
          {['Client', 'Cloud ID', 'Apps', 'Extensions', 'Activity'].map(label => (
            <div key={label} className="lc-label whitespace-nowrap">
              {label}
            </div>
          ))}
        </div>
        {sites.length ? (
          sites.map(site => (
            <div
              key={site.domain}
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
              <div className="whitespace-nowrap font-mono text-micro text-fg3">{site.last}</div>
            </div>
          ))
        ) : (
          <div className="min-w-[696px] px-[18px] py-10 text-center text-body-sm text-fg2">
            {query.trim() ? `No sites match “${query.trim()}”.` : 'No sites are on file.'}
          </div>
        )}
      </div>

      <div className="mt-2 text-micro leading-6 text-fg3">
        Cloud IDs exist only for sites that appear in the Marketplace licence export. Extension grants
        are keyed on a cloud ID inside KV but the listing does not return it, so grant-only sites show{' '}
        <span className="text-bad">none on file</span>. Editing extensions are a Lite-only mechanism,
        which is why every grant-only site reads as <span className="font-mono">lite</span>.
      </div>
    </div>
  )
}
