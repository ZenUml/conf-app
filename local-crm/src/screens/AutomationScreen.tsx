import Chip from '@/components/Chip'
import { count } from '@/lib/format'
import { RULE_TONE } from '@/lib/palette'
import { useCrmStore } from '@/stores/crm'

export default function AutomationScreen() {
  const { data, rules, query } = useCrmStore()

  return (
    <div className="px-6 pb-7 pt-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
        <h3 className="text-h3 font-semibold">What is actually wired up</h3>
        <span className="text-body-sm text-fg2">
          {count(data.rules.length)} mechanisms · verified against production, staging and the local D1 on
          29 Aug
        </span>
      </div>
      {rules.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-4">
          {rules.map(rule => {
            const tone = RULE_TONE[rule.tone]
            return (
              <article
                key={rule.title}
                className="rounded-lg border border-line border-l-[3px] bg-bg1 px-[18px] py-4"
                style={{ borderLeftColor: tone.bar }}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h4 className="text-body font-semibold">{rule.title}</h4>
                  <Chip tone={tone.chip}>{rule.badge}</Chip>
                </div>
                <div className="mb-3 text-micro text-fg2 [overflow-wrap:anywhere]">{rule.scope}</div>
                <div className="flex flex-col gap-[7px]">
                  {rule.items.map(item => (
                    <div key={item} className="flex items-start gap-[9px]">
                      <span className="mt-[7px] size-[5px] shrink-0 rounded-full bg-gray-300" />
                      <div className="text-body-sm leading-6 text-fg1">{item}</div>
                    </div>
                  ))}
                </div>
                <div className="mt-3 border-t border-bg3 pt-2.5 font-mono text-micro text-fg3 [overflow-wrap:anywhere]">
                  {rule.audit}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-bg1 px-5 py-10 text-center text-body-sm text-fg2">
          {query.trim()
            ? `No automation rules match “${query.trim()}”.`
            : 'No automation mechanisms are recorded.'}
        </div>
      )}
    </div>
  )
}
