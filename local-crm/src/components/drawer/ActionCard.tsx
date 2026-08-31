import ConfirmStrip from '../ConfirmStrip'
import type { ActionView } from '@/lib/actions'

interface ActionCardProps {
  action: ActionView
  onRun: (id: string, needsConfirm: boolean) => void
  /** The confirm strip's own control. A repeated CTA click must never reach it. */
  onConfirm: (id: string) => void
  onCancel: () => void
}

/** Danger tone is an outlined red button, never a filled one. */
export default function ActionCard({ action, onRun, onConfirm, onCancel }: ActionCardProps) {
  const button =
    action.tone === 'danger'
      ? 'bg-bg1 border border-bad text-bad'
      : action.tone === 'primary'
        ? 'bg-blue-600 border-0 text-white'
        : 'bg-bg1 border border-gray-300 text-gray-700'

  const border = action.confirming ? 'border-rust-300' : 'border-line'
  const background = action.blocked
    ? 'bg-bg2'
    : action.done
      ? 'bg-[#F6FBF8]'
      : 'bg-bg1'

  return (
    <div className={`rounded-md border px-[15px] py-[13px] ${border} ${background}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div
            className={`text-body-sm font-medium ${action.muted ? 'text-fg2' : 'text-fg1'}`}
          >
            {action.label}
          </div>
          {action.note ? (
            <div className="mt-[3px] text-micro leading-[1.5] text-fg2">{action.note}</div>
          ) : null}
        </div>
        {action.showButton ? (
          <button
            type="button"
            className={`h-[30px] shrink-0 cursor-pointer whitespace-nowrap rounded-md px-3 text-body-sm font-medium ${button}`}
            onClick={() => onRun(action.id, action.needsConfirm)}
          >
            {action.cta}
          </button>
        ) : null}
      </div>

      {action.confirming ? (
        <ConfirmStrip
          text={action.confirmText}
          onConfirm={() => onConfirm(action.id)}
          onCancel={onCancel}
        />
      ) : null}

      {action.done ? (
        <div className="mt-[11px] border-t border-bg3 pt-[11px]">
          <div className="text-micro leading-[1.5] text-fg1">{action.result}</div>
          <div className="mt-1 font-mono text-micro text-fg3">{action.audit}</div>
        </div>
      ) : null}
    </div>
  )
}
