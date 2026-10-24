import { Fragment } from 'react'
import type { Fact } from '@/lib/caseModel'

function isProblem(row: Fact): boolean {
  return Boolean(row.problem) || /\bunknown\b/i.test(row.v)
}

/** Every unknown and every problem renders in danger red. */
export default function FactGrid({ rows }: { rows: Fact[] }) {
  return (
    <div className="grid grid-cols-[118px_1fr] gap-x-[14px] gap-y-[9px] [overflow-wrap:anywhere]">
      {rows.map((row, index) => (
        <Fragment key={`${row.k}:${index}`}>
          <div className="font-mono text-caption text-fg2">{row.k}</div>
          <div className={`font-mono text-caption ${isProblem(row) ? 'text-bad' : 'text-fg1'}`}>
            {row.v}
          </div>
        </Fragment>
      ))}
    </div>
  )
}
