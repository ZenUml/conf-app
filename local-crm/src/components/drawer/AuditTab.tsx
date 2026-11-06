import FactGrid from '../FactGrid'
import SectionLabel from '../SectionLabel'
import type { CaseModel } from '@/lib/caseModel'

interface AuditTabProps {
  model: CaseModel
  log: string[]
}

export default function AuditTab({ model, log }: AuditTabProps) {
  return (
    <div>
      <FactGrid rows={model.audits} />

      <div className="mt-5">
        <SectionLabel className="mb-[9px]">This session</SectionLabel>
        {log.length ? (
          <div className="flex flex-col gap-[6px]">
            {log.map(entry => (
              <div
                key={entry}
                className="font-mono text-micro leading-[1.55] text-fg1 [overflow-wrap:anywhere]"
              >
                {entry}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-micro leading-[1.55] text-fg3">
            Nothing has been run against this case yet.
          </div>
        )}
      </div>
    </div>
  )
}
