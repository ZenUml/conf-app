import { useMemo, useState } from 'react'
import { human } from '@/lib/format'
import { buildQueue, type QueueRow } from '@/lib/queue'
import { useCrmStore } from '@/stores/crm'

/**
 * Today is one queue: what the next move belongs to us on, soonest first.
 *
 * No title, no bands, no filters, no rail. A row states the rule that put it there
 * and carries the facts the decision needs. The score that orders the list is never
 * rendered — each row shows its own stored date.
 */

const LIFECYCLE_LABEL: Record<string, string> = {
  extension: 'extension',
  welcome: 'welcome',
  expiry: 'expiry'
}

function CommandLine({ command }: { command: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      data-testid="queue-command"
      className="mt-1 max-w-full cursor-pointer truncate rounded border border-line bg-bg2 px-2 py-1 text-left font-mono text-micro text-fg2"
      title="Copy this command"
      onClick={event => {
        event.stopPropagation()
        navigator.clipboard?.writeText(command).then(
          () => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1200)
          },
          () => setCopied(false)
        )
      }}
    >
      {copied ? 'copied' : command}
    </button>
  )
}

function Row({ row, onOpen }: { row: QueueRow; onOpen: (() => void) | null }) {
  return (
    <div
      data-testid="queue-row"
      data-reason={row.reason}
      className={`flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md border border-line bg-bg1 px-3 py-2.5 ${
        onOpen ? 'cursor-pointer hover:border-line-strong' : ''
      }`}
      onClick={onOpen ?? undefined}
    >
      <span className="w-[58px] shrink-0 whitespace-nowrap font-mono text-micro text-fg3">
        {human(row.date)}
      </span>
      <span className="w-[70px] shrink-0 font-mono text-micro text-fg3">
        {LIFECYCLE_LABEL[row.lifecycle]}
      </span>
      <div className="min-w-[260px] flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          {row.ticketKey ? (
            <span className="font-mono text-body-sm font-semibold">{row.ticketKey}</span>
          ) : null}
          <span className="text-body-sm text-fg1 [overflow-wrap:anywhere]">{row.title}</span>
          <span className="text-micro text-rust-800">{row.detail}</span>
        </div>
        <div className="mt-0.5 text-micro leading-[1.5] text-fg2 [overflow-wrap:anywhere]">
          {row.evidence}
        </div>
        {row.command ? <CommandLine command={row.command} /> : null}
      </div>
      {row.ticketUrl ? (
        <a
          className="shrink-0 whitespace-nowrap text-micro text-blue-600 no-underline hover:underline"
          href={row.ticketUrl}
          target="_blank"
          rel="noreferrer"
          onClick={event => event.stopPropagation()}
        >
          open ticket
        </a>
      ) : null}
    </div>
  )
}

export default function TodayScreen() {
  const { data, extensionsLoad, open } = useCrmStore()
  const { rows, settled, todos } = useMemo(
    () => buildQueue({
      grants: data.grants,
      openRequests: extensionsLoad.openRequests,
      today: data.today
    }),
    [data.grants, data.today, extensionsLoad.openRequests]
  )

  return (
    <div className="px-6 pb-7 pt-5">
      <div className="flex max-w-[920px] flex-col gap-2" data-testid="today-queue">
        {rows.length === 0 ? (
          <div className="rounded-md border border-line bg-bg1 px-3 py-2.5 text-body-sm text-fg2">
            Nothing is waiting on you.
          </div>
        ) : (
          rows.map(row => (
            <Row
              key={row.id}
              row={row}
              onOpen={row.eventId ? () => open(row.eventId as string) : null}
            />
          ))
        )}

        {todos.map(todo => (
          <div
            key={todo.lifecycle}
            data-testid="queue-todo"
            className="flex flex-wrap items-baseline gap-x-3 rounded-md border border-dashed border-line px-3 py-2 text-fg3"
          >
            <span className="w-[58px] shrink-0 font-mono text-micro">—</span>
            <span className="w-[70px] shrink-0 font-mono text-micro">
              {LIFECYCLE_LABEL[todo.lifecycle]}
            </span>
            <span className="min-w-[260px] flex-1 text-micro leading-[1.5]">
              (todo) {todo.note}
            </span>
          </div>
        ))}

        {settled.length ? (
          <div className="mt-4 flex flex-col gap-1" data-testid="today-settled">
            {settled.map((row, index) => (
              <div
                key={`${row.date}:${row.text}:${index}`}
                className="flex flex-wrap items-baseline gap-x-3 px-3 text-micro text-fg3"
              >
                <span className="w-[58px] shrink-0 whitespace-nowrap font-mono">{human(row.date)}</span>
                <span className="[overflow-wrap:anywhere]">{row.text}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}
