import Chip from '../Chip'
import { dotColor, type LifecycleView } from '@/lib/lifecycle'

interface StageListProps {
  view: LifecycleView
}

/**
 * The vertical lifecycle stage list. Same states as the card rail, read from the
 * same function — `now` carries a chip, `skip` carries the words "never entered".
 */
export default function StageList({ view }: StageListProps) {
  return (
    <div className="flex flex-col">
      {view.stages.map((stage, index) => {
        const dotClass =
          stage.state === 'skip'
            ? 'border border-gray-300 bg-transparent'
            : stage.state === 'todo'
              ? 'bg-gray-200'
              : ''
        const dotStyle =
          stage.state === 'skip' || stage.state === 'todo'
            ? undefined
            : { background: dotColor(stage.state, view.stalled) }

        return (
          <div key={stage.name} className="flex items-start gap-[11px]">
            <div className="flex w-[11px] shrink-0 flex-col items-center self-stretch">
              <span
                className={`mt-[3px] size-[9px] shrink-0 rounded-full ${dotClass}`}
                style={dotStyle}
              />
              <span
                className={`mt-[3px] w-px flex-1 ${
                  index === view.stages.length - 1 ? 'bg-transparent' : 'bg-line'
                }`}
              />
            </div>
            <div className="min-w-0 flex-1 pb-[11px]">
              <div className="flex flex-wrap items-center gap-[7px]">
                <span
                  className={`font-mono text-caption ${
                    stage.state === 'now' ? 'font-semibold' : 'font-medium'
                  } ${
                    stage.state === 'todo' || stage.state === 'skip'
                      ? 'text-fg3'
                      : 'text-fg1'
                  }`}
                >
                  {stage.name}
                </span>
                {stage.state === 'now' ? <Chip tone="pending">now</Chip> : null}
                {stage.state === 'skip' ? (
                  <span className="text-micro text-fg3">never entered</span>
                ) : null}
              </div>
              {stage.note ? (
                <div className="mt-[3px] text-micro leading-[1.5] text-fg2 [overflow-wrap:anywhere]">
                  {stage.note}
                </div>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}
