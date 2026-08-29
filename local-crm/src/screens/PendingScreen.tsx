import Chip from '@/components/Chip'
import {
  buildPendingRows,
  pendingGrantMode,
  pendingPartialDetail,
  summarizePending
} from '@/data/pendingApi'
import { count, human } from '@/lib/format'
import type { ChipTone } from '@/lib/palette'
import { useCrmStore } from '@/stores/crm'

const SOURCE_LABELS = {
  marketplace: 'Marketplace',
  jsm: 'JSM',
  space_license_kv: 'grant KV',
  extension_action_d1: 'action D1'
} as const

function statusTone(status: 'active' | 'expired' | 'inactive' | 'unknown'): ChipTone {
  if (status === 'active') return 'sent'
  if (status === 'expired') return 'failed'
  if (status === 'inactive') return 'skipped'
  return 'blocked'
}

function evidenceTone(state: 'known' | 'unknown' | 'unavailable'): ChipTone {
  if (state === 'known') return 'sent'
  if (state === 'unavailable') return 'failed'
  return 'blocked'
}

function dateLabel(value: string | null): string {
  return value ? human(value.slice(0, 10)) : 'unknown'
}

export default function PendingScreen() {
  const { data, pendingRows, query, extensionsLoad, open } = useCrmStore()
  const mode = pendingGrantMode(extensionsLoad)
  const summary = summarizePending(buildPendingRows(data))

  return (
    <div className="flex flex-col gap-5 px-6 pb-7 pt-5">
      <section
        data-testid="pending-source-status"
        data-pending-mode={mode}
        className={`rounded-lg border px-4 py-3 ${
          mode === 'live'
            ? 'border-[color:var(--color-success)] bg-bg1'
            : mode === 'partial'
              ? 'border-[color:var(--accent-drawio-500)] bg-bg1'
              : mode === 'unavailable'
                ? 'border-[color:var(--color-danger)] bg-bg1'
                : 'border-line bg-bg1'
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-[760px]">
            <div className="text-body-sm font-semibold">
              {mode === 'live'
                ? 'Live site-mapping evidence'
                : mode === 'partial'
                  ? 'Partial live site-mapping evidence'
                  : mode === 'unavailable'
                    ? 'Pending evidence unavailable'
                    : 'Loading site-mapping evidence…'}
            </div>
            <div className="mt-1 text-micro leading-6 text-fg2">
              {mode === 'live' || mode === 'partial'
                ? `Queue membership comes from current SPACE_LICENSE_KV grants joined to the Marketplace export${extensionsLoad.generatedAt ? `, read ${new Date(extensionsLoad.generatedAt).toLocaleString()}` : ''}. ${mode === 'partial' ? pendingPartialDetail(extensionsLoad) : 'JSM and ExtensionAction evidence is shown only where returned.'}`
                : mode === 'unavailable'
                  ? `${extensionsLoad.error ?? 'The grant KV or Marketplace join is unavailable.'} No sanitized pending rows are substituted.`
                  : 'The required grant KV and Marketplace reads are in progress. No sanitized pending rows are substituted.'}
            </div>
            <div className="mt-1 text-micro leading-6 text-fg3">
              No assignment or Site Contact store is connected. These are evidence-review candidates, not assigned cases; this page has no write actions.
            </div>
          </div>
          {extensionsLoad.sources ? (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(extensionsLoad.sources).map(([key, source]) => (
                <span
                  key={key}
                  data-testid={`pending-source-${key}`}
                  className="rounded-full border border-line bg-bg2 px-2 py-1 font-mono text-micro text-fg2"
                >
                  {SOURCE_LABELS[key as keyof typeof SOURCE_LABELS]} · {source.records} · {source.state}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      <section>
        <div className="mb-2.5 flex flex-wrap items-baseline gap-2.5">
          <h3 className="text-h3 font-semibold">Site mapping evidence queue</h3>
          <span data-testid="pending-summary" className="text-body-sm text-fg2">
            {count(summary.total)} current grants · {count(summary.active)} active · {count(summary.unknown)} status unknown · {count(summary.expired)} expired · {count(summary.inactive)} inactive · {count(summary.withRequestEvidence)} with request evidence
          </span>
        </div>
        <div className="mb-3 text-micro leading-6 text-fg3">
          Ordered by observed KV status, then available review evidence and timestamp. This is deterministic review order, not an inferred urgency or ownership claim.
        </div>
        {pendingRows.length ? (
          <div className="flex flex-col gap-3">
            {pendingRows.map(row => (
              <button
                type="button"
                key={row.id}
                data-testid={`pending-row-${row.grantId}`}
                onClick={() => open(row.eventId)}
                className="lc-t-bg w-full cursor-pointer rounded-lg border border-line bg-bg1 px-[18px] py-4 text-left hover:bg-bg2"
                aria-label={`Open site mapping evidence for grant ${row.grantId}`}
              >
                <div className="flex flex-wrap items-start gap-4">
                  <div className="min-w-[250px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[13px] font-medium text-fg1">
                        cloud {row.cloudPrefix}… · {row.space}
                      </span>
                      <Chip tone={statusTone(row.status)}>{row.reviewBand}</Chip>
                      <Chip tone={row.mappingKind === 'hostname_missing' ? 'blocked' : 'failed'}>
                        {row.mappingKind === 'hostname_missing' ? 'hostname missing' : 'no Marketplace row'}
                      </Chip>
                    </div>
                    <div className="mt-2 text-body-sm leading-[1.55] text-fg2">{row.mappingEvidence}</div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div className="rounded-md bg-bg2 px-3 py-2">
                        <div className="mb-1 flex items-center gap-1.5">
                          <span className="lc-label">Request evidence</span>
                          <Chip tone={evidenceTone(row.requestEvidenceState)}>{row.requestEvidenceState}</Chip>
                        </div>
                        <div className="text-micro leading-6 text-fg2">{row.requestEvidence}</div>
                      </div>
                      <div className="rounded-md bg-bg2 px-3 py-2">
                        <div className="mb-1 flex items-center gap-1.5">
                          <span className="lc-label">Action audit</span>
                          <Chip tone={evidenceTone(row.actionEvidenceState)}>{row.actionEvidenceState}</Chip>
                        </div>
                        <div className="text-micro leading-6 text-fg2">{row.actionEvidence}</div>
                      </div>
                    </div>
                  </div>
                  <div className="flex min-w-[170px] flex-col items-end gap-[7px] font-mono text-micro text-fg3">
                    <span>{row.scope}</span>
                    <span>created {dateLabel(row.createdAt)}</span>
                    <span>expires {dateLabel(row.expiresAt)}</span>
                    <span>origin {row.origin}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-line bg-bg1 px-5 py-10 text-center text-body-sm text-fg2">
            {query.trim()
              ? `No source-backed Pending rows match “${query.trim()}”.`
              : mode === 'live' || mode === 'partial'
                ? 'The healthy source snapshot contains no grants requiring site-mapping evidence review.'
                : mode === 'loading'
                  ? 'Waiting for the required source reads; no fixture queue is shown.'
                  : 'The required mapping evidence is unavailable; no queue claim is made.'}
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-bg1 px-[18px] py-4">
        <div className="mb-1.5 text-body font-semibold">Scope boundary</div>
        <div className="text-body-sm leading-[1.6] text-fg2">
          This queue covers current extension grants that cannot be joined to a verified site hostname. A source-backed Welcome assignment queue and open JSM requests without a current KV grant are not connected in this slice.
        </div>
      </section>
    </div>
  )
}
