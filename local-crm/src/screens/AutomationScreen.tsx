import { count } from '@/lib/format'
import { useCrmStore } from '@/stores/crm'

export default function AutomationScreen() {
  const { data, extensionsLoad, query } = useCrmStore()
  const actions = data.grants.flatMap(grant => (grant.actionAudit ?? []).map(action => ({ grant, action })))
  const visible = actions.filter(({ grant, action }) => {
    const needle = query.trim().toLowerCase()
    return !needle || [grant.domain, grant.cloudId, grant.space, action.action, action.status].some(value => value?.toLowerCase().includes(needle))
  })
  const d1 = extensionsLoad.sources?.extension_action_d1

  return (
    <div className="px-6 pb-7 pt-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-2.5">
        <h3 className="text-h3 font-semibold">What is actually wired up</h3>
        <span className="text-body-sm text-fg2">
          read-only observed ExtensionAction audit · no workflow configuration is inferred from code or fixtures
        </span>
      </div>
      <div className="mb-3 rounded-md border border-line bg-bg2 px-3.5 py-2 text-micro text-fg2">
        {d1?.state === 'ok'
          ? `ExtensionAction D1 · ${count(d1.records)} rows · current API read ${extensionsLoad.generatedAt ? new Date(extensionsLoad.generatedAt).toLocaleString() : ''}`
          : extensionsLoad.state === 'loading'
            ? 'ExtensionAction D1 is loading. No fixture automation rows are substituted.'
            : `${d1?.detail ?? extensionsLoad.error ?? 'ExtensionAction D1 is unavailable'}. No fixture automation rows are substituted.`}
      </div>
      {visible.length ? (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(340px,1fr))] items-start gap-4">
          {visible.map(({ grant, action }) => {
            return (
              <article
                key={`${grant.id}:${action.createdAt}:${action.action}`}
                className="rounded-lg border border-line border-l-[3px] bg-bg1 px-[18px] py-4"
                style={{ borderLeftColor: 'var(--color-primary)' }}
              >
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <h4 className="text-body font-semibold">{action.action} · {action.status}</h4>
                </div>
                <div className="mb-3 text-micro text-fg2 [overflow-wrap:anywhere]">{grant.domain} · {grant.space} · current grant status {grant.status}</div>
                <div className="mt-3 border-t border-bg3 pt-2.5 font-mono text-micro text-fg3 [overflow-wrap:anywhere]">
                  created {action.createdAt ?? 'unknown'} · updated {action.updatedAt ?? 'unknown'} · expires {action.expiresAt ?? 'unknown'}
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-line bg-bg1 px-5 py-10 text-center text-body-sm text-fg2">
          {query.trim()
            ? `No observed automation actions match “${query.trim()}”.`
            : d1?.state === 'ok'
              ? 'No ExtensionAction audit rows are currently recorded.'
              : 'Automation audit evidence is unavailable.'}
        </div>
      )}
    </div>
  )
}
