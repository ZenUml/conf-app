import type { ActionSpec, CaseModel } from './caseModel'
import { WRITE_ACTIONS } from './lifecycle'

export interface ActionView {
  key: string
  /** `<eventId>:<actionKey>` — the key both `confirming` and `done` are stored under. */
  id: string
  label: string
  cta: string
  note: string
  /** True when the action cannot run at all: no button, muted title. */
  blocked: boolean
  /** True when a blocker on the case suppresses this write. Also no button. */
  held: boolean
  muted: boolean
  showButton: boolean
  confirming: boolean
  confirmText: string
  needsConfirm: boolean
  done: boolean
  result: string
  /** `done · <timestamp>` once run. */
  audit: string
  tone: 'primary' | 'danger' | 'default'
}

export interface NextStep extends ActionView {
  why: string
  /** Non-empty means the case is blocked: no button anywhere in the drawer. */
  blockers: string[]
  stalled: boolean
}

export interface DrawerActions {
  next: NextStep
  more: ActionView[]
}

/**
 * Blocked means no button. When a case carries blockers, every write-class
 * action is suppressed everywhere in the drawer — not greyed, not confirm-gated:
 * the button is absent and the row reads "Held while the case is blocked."
 * Read-only actions (readback, open ticket) stay live.
 */
export function buildActions(
  model: CaseModel,
  eventId: string,
  confirming: string | null,
  done: Record<string, string>
): DrawerActions {
  const stalled = model.blockers.length > 0
  const mapped = model.actions
    .filter(action => action.key !== 'preview')
    .map(action => view(action, eventId, stalled, confirming, done))

  const primary = model.nextKey ? (mapped.find(item => item.key === model.nextKey) ?? null) : null
  const more = mapped.filter(item => item !== primary)

  const base: ActionView = primary ?? {
    key: '',
    id: '',
    label: model.nextLabel,
    cta: '',
    note: '',
    blocked: false,
    held: false,
    muted: false,
    showButton: false,
    confirming: false,
    confirmText: '',
    needsConfirm: false,
    done: false,
    result: '',
    audit: '',
    tone: 'default'
  }

  return {
    next: {
      ...base,
      label: model.nextLabel || base.label,
      why: model.nextWhy,
      blockers: model.blockers,
      stalled,
      showButton: !stalled && base.showButton
    },
    more
  }
}

function view(
  action: ActionSpec,
  eventId: string,
  stalled: boolean,
  confirming: string | null,
  done: Record<string, string>
): ActionView {
  const id = `${eventId}:${action.key}`
  const stamp = done[id]
  const blocked = Boolean(action.blocked)
  const held = stalled && (WRITE_ACTIONS as readonly string[]).includes(action.key)

  return {
    key: action.key,
    id,
    label: action.label,
    cta: action.cta ?? '',
    note: held ? `Held while the case is blocked. ${action.note ?? ''}`.trim() : (action.blocked ?? action.note ?? ''),
    blocked,
    held,
    muted: blocked || held,
    showButton: !blocked && !held && !stamp && Boolean(action.cta),
    confirming: confirming === id,
    confirmText: action.confirmText ?? '',
    needsConfirm: Boolean(action.confirm),
    done: Boolean(stamp),
    result: action.result ?? '',
    audit: stamp ? `done · ${stamp}` : '',
    tone: action.tone ?? 'default'
  }
}
