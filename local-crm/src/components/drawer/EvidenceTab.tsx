import Chip from '../Chip'
import FactGrid from '../FactGrid'
import SectionLabel from '../SectionLabel'
import ActionCard from './ActionCard'
import StageList from './StageList'
import type { CaseModel } from '@/lib/caseModel'
import type { ActionView } from '@/lib/actions'

interface EvidenceTabProps {
  model: CaseModel
  more: ActionView[]
  onRun: (id: string, needsConfirm: boolean) => void
  onCancel: () => void
}

export default function EvidenceTab({ model, more, onRun, onCancel }: EvidenceTabProps) {
  return (
    <div>
      <div className="mb-[22px]">
        <SectionLabel className="mb-[11px]">Lifecycle stage</SectionLabel>
        <StageList view={model.lifecycle} />
        {model.lifecycle.branches ? (
          <div className="pt-[2px] text-micro leading-[1.55] text-fg3">
            {model.lifecycle.branches}
          </div>
        ) : null}
      </div>

      <FactGrid rows={model.facts} />

      {model.classes.length ? (
        <div className="mt-[22px]">
          <SectionLabel className="mb-[10px]">Which departure this is</SectionLabel>
          <div className="flex flex-col gap-[7px]">
            {model.classes.map(row => (
              <div
                key={row.name}
                className={`rounded-md border px-3 py-[10px] ${
                  row.applies ? 'border-blue-100 bg-blue-50' : 'border-line bg-bg2'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`font-mono text-caption font-medium ${
                      row.applies ? 'text-fg1' : 'text-fg2'
                    }`}
                  >
                    {row.name}
                  </span>
                  <Chip tone={row.applies ? 'sent' : 'skipped'}>{row.verdict}</Chip>
                </div>
                <div className="mt-1 text-micro leading-[1.5] text-fg2 [overflow-wrap:anywhere]">
                  {row.note}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {more.length ? (
        <div className="mt-[22px]">
          <SectionLabel className="mb-[10px]">Other things you can do</SectionLabel>
          <div className="flex flex-col gap-2">
            {more.map(action => (
              <ActionCard
                key={action.key}
                action={action}
                onRun={onRun}
                onCancel={onCancel}
              />
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-[22px] border-t border-bg3 pt-[14px]">
        <SectionLabel className="mb-[7px]">Where this came from</SectionLabel>
        <div className="font-mono text-micro leading-[1.6] text-fg2 [overflow-wrap:anywhere]">
          {model.provenance}
        </div>
      </div>
    </div>
  )
}
