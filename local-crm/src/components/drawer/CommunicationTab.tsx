import Chip from '../Chip'
import type { CaseModel } from '@/lib/caseModel'

interface CommunicationTabProps {
  model: CaseModel
}

/**
 * One track per real recipient. The track count differs per case and that is the
 * point: `sent`, `delivered` and `replied` are always separate rows, because a
 * posted reply is not an acknowledgement and delivery is not a reply.
 */
export default function CommunicationTab({ model }: CommunicationTabProps) {
  return (
    <div className="flex flex-col gap-4">
      {model.tracks.map(track => (
        <div key={track.name}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-body-sm font-semibold text-fg1">{track.name}</span>
            <Chip tone={track.chip}>{track.state}</Chip>
          </div>
          <div className="mt-[3px] text-micro leading-[1.5] text-fg3">{track.who}</div>
          <div className="mt-[9px] flex flex-col gap-[7px]">
            {track.rows.map(row => (
              <div
                key={row.k}
                className="flex items-start gap-[10px] rounded-md border border-line bg-bg1 px-[11px] py-[9px]"
              >
                <span className="w-[66px] shrink-0 font-mono text-[11px] text-fg3">
                  {row.k}
                </span>
                <span
                  className={`text-micro leading-[1.5] [overflow-wrap:anywhere] ${
                    row.problem || /\bunknown\b/i.test(row.v) ? 'text-bad' : 'text-fg1'
                  }`}
                >
                  {row.v}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="border-t border-bg3 pt-3 text-micro leading-[1.55] text-fg3">
        {model.commsNote}
      </div>
    </div>
  )
}
