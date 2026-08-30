import FactGrid from '../FactGrid'
import SectionLabel from '../SectionLabel'
import type { Fact } from '@/lib/caseModel'
import { human } from '@/lib/format'
import { useCrmStore } from '@/stores/crm'

function CloseButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      className="flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-fg2 hover:bg-bg3"
      aria-label="Close"
      onClick={onClick}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="size-[18px]">
        <path d="M6 18L18 6M6 6l12 12" />
      </svg>
    </button>
  )
}

function CopyCommand({ command }: { command: string | null }) {
  if (!command) {
    return <div className="text-micro leading-[1.5] text-fg2">No command is ready: resolve both the site and the space first.</div>
  }
  return (
    <button
      type="button"
      data-testid="queue-drawer-command"
      className="mt-2 max-w-full cursor-pointer rounded border border-line bg-bg2 px-2 py-1 text-left font-mono text-micro text-fg2"
      title="Copy this command"
      onClick={() => void navigator.clipboard?.writeText(command)}
    >
      {command}
    </button>
  )
}

export default function QueueRequestDrawer() {
  const { selectedQueueRow: row, close, go, setQuery } = useCrmStore()
  if (!row) return null

  const facts: Fact[] = [
    { k: 'cloud_id', v: row.cloudId ?? 'unavailable', problem: !row.cloudId },
    { k: 'requester', v: row.requester ?? 'unavailable', problem: !row.requester },
    { k: 'request macros', v: row.evidence || 'unavailable', problem: !row.evidence },
    { k: 'ticket status', v: row.detail }
  ]
  const comments = row.comments
  const commentFacts: Fact[] = !comments
    ? [{ k: 'comment evidence', v: 'unavailable' , problem: true }]
    : comments.state === 'unknown'
      ? [{ k: 'comment evidence', v: comments.reason ?? 'unavailable', problem: true }]
      : [
          { k: 'public comments', v: comments.publicCommentCount === null ? `unavailable — ${comments.unavailableReasons.publicCommentCount ?? 'JSM comment count unavailable'}` : String(comments.publicCommentCount), problem: comments.publicCommentCount === null },
          { k: 'requester comments', v: comments.requesterCommentCount === null ? `unavailable — ${comments.unavailableReasons.requesterCommentCount ?? 'requester authorship unavailable'}` : String(comments.requesterCommentCount), problem: comments.requesterCommentCount === null },
          { k: 'last author', v: comments.lastCommentAuthor ?? `unavailable — ${comments.unavailableReasons.lastCommentAuthor ?? 'JSM comment author unavailable'}`, problem: comments.lastCommentAuthor === null },
          { k: 'last speaker', v: comments.lastCommentAuthorship.replace('_', ' ') },
          { k: 'last comment', v: comments.lastCommentAt ?? `unavailable — ${comments.unavailableReasons.lastCommentAt ?? 'JSM comment timestamp unavailable'}`, problem: comments.lastCommentAt === null },
          { k: 'first line', v: comments.lastCommentFirstLine ?? `unavailable — ${comments.unavailableReasons.lastCommentFirstLine ?? 'JSM comment first line unavailable'}`, problem: comments.lastCommentFirstLine === null }
        ]

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[rgba(9,30,66,0.32)]" onClick={close} />
      <div className="lc-drawer relative flex h-full w-[540px] max-w-full flex-col bg-bg1 shadow-xl" role="dialog" aria-modal="true" aria-label={`Extension request ${row.ticketKey ?? ''}`}>
        <div className="shrink-0 border-b border-line px-[22px] py-[18px]">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-[7px]">
                <span className="lc-label">extension request</span>
                <span className="font-mono text-micro text-fg3">{human(row.date)}</span>
              </div>
              <h3 className="mt-[9px] font-mono text-h3 font-semibold [overflow-wrap:anywhere]">{row.ticketKey ?? 'ticket not recorded'}</h3>
              <div className="mt-[5px] text-body-sm leading-[1.5] text-fg2">{row.title}</div>
            </div>
            <CloseButton onClick={close} />
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-micro">
            {row.ticketUrl ? <a href={row.ticketUrl} target="_blank" rel="noreferrer" className="text-blue-600 no-underline hover:underline">open ticket</a> : null}
            {row.cloudId ? <button type="button" className="cursor-pointer border-0 bg-transparent p-0 text-blue-600 hover:underline" onClick={() => { setQuery(row.cloudId ?? ''); go('sites') }}>view tenant</button> : null}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px]">
          <section>
            <SectionLabel className="mb-[11px]">Decision evidence</SectionLabel>
            <FactGrid rows={facts} />
          </section>
          <section className="mt-[22px] rounded-md border border-line bg-bg2 px-3 py-3">
            <SectionLabel>Hand over command</SectionLabel>
            <CopyCommand command={row.command} />
          </section>
          <section className="mt-[22px]">
            <SectionLabel className="mb-[11px]">Ticket comment evidence</SectionLabel>
            <FactGrid rows={commentFacts} />
            <div className="mt-3 text-micro leading-[1.5] text-fg3">Only comment metadata and the first non-empty line cross the loopback contract; the remaining body stays in JSM.</div>
          </section>
        </div>
        <div className="shrink-0 border-t border-line bg-bg2 px-[22px] py-3 font-mono text-micro leading-[1.5] text-fg3">Today queue · {row.reason.replaceAll('_', ' ')}</div>
      </div>
    </div>
  )
}
