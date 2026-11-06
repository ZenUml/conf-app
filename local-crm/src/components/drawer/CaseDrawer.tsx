import Chip from '../Chip'
import ConfirmStrip from '../ConfirmStrip'
import SectionLabel from '../SectionLabel'
import AuditTab from './AuditTab'
import CommunicationTab from './CommunicationTab'
import EvidenceTab from './EvidenceTab'
import { buildActions } from '@/lib/actions'
import { useCrmStore, type DrawerTab } from '@/stores/crm'

const TABS = [
  { key: 'evidence', label: 'Evidence' },
  { key: 'comms', label: 'Communication' },
  { key: 'audit', label: 'Audit' }
] as const satisfies ReadonlyArray<{ key: DrawerTab; label: string }>

export default function CaseDrawer() {
  const store = useCrmStore()
  const model = store.detail
  const actions =
    model && store.selectedEvent
      ? buildActions(model, store.selectedEvent.id, store.confirming, store.done)
      : null

  if (!model || !actions) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-[rgba(9,30,66,0.32)]" onClick={store.close} />

      <div
        className="lc-drawer relative flex h-full w-[540px] max-w-full flex-col bg-bg1 shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-label={`${model.caseType} case for ${model.who}`}
      >
        {/* Header: a decision bar, not a title bar. */}
        <div className="shrink-0 border-b border-line px-[22px] pt-[18px]">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-[7px]">
                <span className="lc-label">{model.caseType} case</span>
                <Chip tone={model.statusChip}>{model.status}</Chip>
                <span className="font-mono text-micro text-fg3">
                  {model.date} · {model.rel}
                </span>
              </div>
              <h3 className="mt-[9px] font-mono text-h3 font-semibold [overflow-wrap:anywhere]">
                {model.who}
              </h3>
              <div className="mt-[5px] text-body-sm leading-[1.5] text-fg2">{model.what}</div>
            </div>
            <button
              type="button"
              className="flex size-[30px] shrink-0 cursor-pointer items-center justify-center rounded-md border-0 bg-transparent text-fg2 hover:bg-bg3"
              aria-label="Close"
              onClick={store.close}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                className="size-[18px]"
              >
                <path d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Only next step. Amber when blocked, and then it renders no button. */}
          <div
            className={`mt-[14px] rounded-md border px-[15px] py-[13px] ${
              actions.next.stalled ? 'border-amber-100 bg-amber-50' : 'border-line bg-bg2'
            }`}
          >
            <SectionLabel>Only next step</SectionLabel>
            <div className="mt-[6px] flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className="text-body font-medium leading-[1.45] text-fg1">
                  {actions.next.label}
                </div>
                <div className="mt-1 text-micro leading-[1.5] text-fg2">
                  {actions.next.why}
                </div>
              </div>
              {actions.next.showButton ? (
                <button
                  type="button"
                  className="h-8 shrink-0 cursor-pointer whitespace-nowrap rounded-md border-0 bg-blue-600 px-[15px] text-body-sm font-medium text-white"
                  onClick={() => store.run(actions.next.id, actions.next.needsConfirm)}
                >
                  {actions.next.cta}
                </button>
              ) : null}
            </div>

            {actions.next.stalled ? (
              <div className="mt-[10px] flex flex-col gap-[5px]">
                {actions.next.blockers.map(blocker => (
                  <div key={blocker} className="flex items-start gap-2">
                    <span className="mt-[7px] size-1 shrink-0 rounded-full bg-amber-500" />
                    <div className="text-micro leading-[1.5] text-fg1 [overflow-wrap:anywhere]">
                      {blocker}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {actions.next.confirming ? (
              <ConfirmStrip
                text={actions.next.confirmText}
                onConfirm={() => store.confirmRun(actions.next.id)}
                onCancel={store.cancel}
              />
            ) : null}

            {actions.next.done ? (
              <div className="mt-[11px] border-t border-bg3 pt-[11px]">
                <div className="text-micro leading-[1.5] text-fg1">{actions.next.result}</div>
                <div className="mt-1 font-mono text-micro text-fg3">{actions.next.audit}</div>
              </div>
            ) : null}
          </div>

          <div
            className="mt-[14px] flex gap-[2px]"
            role="tablist"
            aria-label="Case details"
          >
            {TABS.map(entry => (
              <button
                type="button"
                key={entry.key}
                id={`case-tab-${entry.key}`}
                role="tab"
                aria-selected={store.tab === entry.key}
                aria-controls={`case-panel-${entry.key}`}
                className={`h-8 cursor-pointer border-0 border-b-2 bg-transparent px-3 text-body-sm font-medium ${
                  store.tab === entry.key
                    ? 'border-blue-600 text-fg1'
                    : 'border-transparent text-fg3'
                }`}
                onClick={() => store.setTab(entry.key)}
              >
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <div
          id={`case-panel-${store.tab}`}
          role="tabpanel"
          aria-labelledby={`case-tab-${store.tab}`}
          className="min-h-0 flex-1 overflow-y-auto px-[22px] py-[18px]"
        >
          {store.tab === 'evidence' ? (
            <EvidenceTab
              model={model}
              more={actions.more}
              onRun={store.run}
              onConfirm={store.confirmRun}
              onCancel={store.cancel}
            />
          ) : store.tab === 'comms' ? (
            <CommunicationTab model={model} />
          ) : (
            <AuditTab model={model} log={store.sessionLog} />
          )}
        </div>

        <div className="shrink-0 border-t border-line bg-bg2 px-[22px] py-3">
          <div className="font-mono text-micro leading-[1.5] text-fg3">{model.footer}</div>
        </div>
      </div>
    </div>
  )
}
