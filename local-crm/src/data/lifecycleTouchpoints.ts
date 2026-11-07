import type { LifecycleTouchpointRecord } from './lifecycleContract'

export function lifecycleTouchpointSummary(touchpoints: LifecycleTouchpointRecord[]) {
  const byKind: Record<string, number> = {}
  const byStep: Record<string, number> = {}
  for (const touchpoint of touchpoints) {
    byKind[touchpoint.kind] = (byKind[touchpoint.kind] ?? 0) + 1
    if (touchpoint.step) byStep[touchpoint.step] = (byStep[touchpoint.step] ?? 0) + 1
  }
  return { total: touchpoints.length, byKind, byStep }
}

/**
 * This is deliberately narrower than the lifecycle schema's historic comments:
 * a local row proves only that this local process recorded an observation.
 */
export function localObservationLabel(touchpoint: LifecycleTouchpointRecord) {
  return `Local lifecycle observation · ${touchpoint.step ?? touchpoint.kind}`
}
