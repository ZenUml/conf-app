import type { CaseEvent } from '@/lib/derive'
import { lifecycleOf } from '@/lib/lifecycle'
import { useCrmStore } from '@/stores/crm'
import Chip from './Chip'
import StageDots from './StageDots'

export default function EventCard({
  event,
  onOpen
}: {
  event: CaseEvent
  onOpen: () => void
}) {
  const { data } = useCrmStore()
  const view = lifecycleOf(data, event.kind, event.grant ?? null)
  return (
    <button
      type="button"
      className="lc-t-border flex w-full cursor-pointer gap-[11px] rounded-md border border-line bg-bg1 px-[14px] py-3 text-left hover:border-line-strong"
      onClick={onOpen}
    >
      <span
        className="mt-[5px] size-[9px] shrink-0 rounded-full"
        style={{ background: event.dot }}
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-body-sm font-semibold [overflow-wrap:anywhere]">
            {event.who}
          </span>
          <Chip tone={event.chip}>{event.tag}</Chip>
        </span>
        <span className="mt-1 block text-body-sm leading-[1.5] text-fg2">{event.what}</span>
        <span className="mt-[5px] block font-mono text-micro text-fg3 [overflow-wrap:anywhere]">
          {event.meta}
        </span>
        <StageDots view={view} />
      </span>
    </button>
  )
}
