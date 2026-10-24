import {
  dotColor,
  stageLabel,
  stageLabelTone,
  type LifecycleView
} from '@/lib/lifecycle'

/** The compact lifecycle rail on a stream card: 6px dots, then the stage label. */
export default function StageDots({ view }: { view: LifecycleView }) {
  const tone = stageLabelTone(view)
  return (
    <div className="mt-2 flex flex-wrap items-center gap-[9px]">
      <div className="flex items-center gap-[3px]">
        {view.stages.map(stage => (
          <span
            key={stage.name}
            className={`box-border size-[6px] shrink-0 rounded-full ${
              stage.state === 'skip' ? 'border border-gray-300 bg-transparent' : ''
            }`}
            style={
              stage.state === 'skip'
                ? undefined
                : { background: dotColor(stage.state, view.stalled) }
            }
            title={`${stage.name} · ${stage.state === 'skip' ? 'never entered' : stage.state}`}
          />
        ))}
      </div>
      <span className={`font-mono text-[11px] ${tone === 'amber' ? 'text-amber-800' : 'text-fg2'}`}>
        {stageLabel(view)}
      </span>
    </div>
  )
}
