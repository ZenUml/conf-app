import { getClientDomain } from '@/utils/ContextParameters/ContextParameters'

/**
 * Editor staleness hint — core predicates and markers.
 * Spec: docs/superpowers/specs/2026-07-18-job-b-editor-staleness-hint-design.md
 * Surface signature is spike-verified (2026-07-18 findings, Q1): the inline
 * page-editor render is the ONLY surface with isEditing=true and no modal.
 * The existing isEditorish check in forgeIndex covers the edit modal, not
 * this; extension.macro.isConfiguring never appears on render-time contexts.
 */

export const DRIFT_THRESHOLD = 5
export const DISMISS_SILENCE_MS = 30 * 24 * 60 * 60 * 1000

export function isInlineEditorRender(context: any): boolean {
  const ext = context?.extension
  return ext?.type === 'macro' && ext?.isEditing === true && !ext?.modal
}

function normalizeKeyPart(value: string): string {
  return encodeURIComponent(value || 'unknown')
}

export function dismissMarkerKey(ccId: string, clientDomain: string = getClientDomain() || 'unknown'): string {
  return ['stalenessHint', normalizeKeyPart(clientDomain), normalizeKeyPart(ccId)].join(':')
}

export interface DismissMarker {
  dismissedAt: string
}

export function readDismissMarker(ccId: string): DismissMarker | null {
  try {
    const raw = localStorage.getItem(dismissMarkerKey(ccId))
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<DismissMarker>
    return typeof p.dismissedAt === 'string' ? { dismissedAt: p.dismissedAt } : null
  } catch {
    return null
  }
}

export function writeDismissMarker(ccId: string): void {
  try {
    localStorage.setItem(dismissMarkerKey(ccId), JSON.stringify({ dismissedAt: new Date().toISOString() }))
  } catch (e) {
    console.warn('[staleness-hint] dismiss marker write failed', e)
  }
}

export function isDismissalActive(marker: DismissMarker | null, now: number = Date.now()): boolean {
  if (!marker) return false
  const t = Date.parse(marker.dismissedAt)
  if (!Number.isFinite(t)) return false
  return now - t <= DISMISS_SILENCE_MS
}
