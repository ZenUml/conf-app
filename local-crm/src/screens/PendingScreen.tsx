import Chip from '@/components/Chip'
import { count } from '@/lib/format'
import { useCrmStore } from '@/stores/crm'

export default function PendingScreen() {
  const { data, unresolved, query } = useCrmStore()
  const unresolvedTotal = data.grants.filter(grant => grant.domain.startsWith('(')).length

  return (
    <div className="flex flex-col gap-5 px-6 pb-7 pt-5">
      <section>
        <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
          <h3 className="text-h3 font-semibold">Grants with no client behind them</h3>
          <span className="text-body-sm text-fg2">
            {count(unresolvedTotal)} of the {count(data.grants.length)} KV grants carry a cloud ID that
            matches nothing in the licence export
          </span>
        </div>
        {unresolved.length ? (
          <div className="flex flex-col gap-3">
            {unresolved.map(row => (
              <article key={`${row.key}:${row.audit}`} className="rounded-lg border border-line bg-bg1 px-[18px] py-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-[240px] flex-1">
                    <div className="font-mono text-[13px] font-medium text-bad [overflow-wrap:anywhere]">
                      {row.key}
                    </div>
                    <div className="mt-1.5 text-body-sm text-fg2">{row.detail}</div>
                    <div className="mt-[7px] font-mono text-micro text-fg3 [overflow-wrap:anywhere]">
                      {row.audit}
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-[7px]">
                    <Chip tone={row.active ? 'sent' : 'skipped'}>{row.state}</Chip>
                    <span className="font-mono text-micro text-fg3">{row.expires}</span>
                  </div>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-bg1 px-5 py-10 text-center text-body-sm text-fg2">
            {query.trim()
              ? `No unresolved grants match “${query.trim()}”.`
              : 'No grants are waiting for client assignment.'}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-bg1 px-[18px] py-4">
        <div className="mb-1.5 text-body font-semibold">There is no pending queue on the Welcome side</div>
        <div className="text-body-sm leading-[1.6] text-fg2">
          A licence row without a cloud ID is rejected outright at transform, before any contact row is
          written — {count(data.ingest.rejectedNoCloudId)} of the {count(data.ingest.rowsRead)} rows in the
          last export, every one of them a legacy Server-hosted entitlement. Nothing is held for later
          assignment, so this surface has nothing to show from the ingest. Whether those{' '}
          {count(data.ingest.rejectedNoCloudId)} deserve a queue is an open product question, not a gap in
          the data.
        </div>
        <div className="mt-2.5 font-mono text-micro text-fg3 [overflow-wrap:anywhere]">
          ingestCore.mjs transformRow → skipped.no_cloud_id · lifecycle_contact.cloud_id is NOT NULL
        </div>
      </section>
    </div>
  )
}
