// Auto-open marker for the starter-template gallery's first-entry surface
// (onboarding funnel — see Header.vue's mounted() for the trigger condition:
// create mode, empty source, macro type has templates).
//
// Storage choice mirrors draftStore.ts: localStorage on the iframe origin.
// draftStore.ts's own header comment documents this as CONFIRMED working
// inside the Forge Custom UI iframe (drafts survive accidental-close today),
// so we reuse it rather than guessing.
//
// Scope is cloudId + macro type, not accountId + macro type. accountId is
// not available synchronously here (Header.vue's mounted() only awaits
// view.getContext() for cloudId via draftStore's primeCloudId/
// getCachedCloudId) — the same constraint documented in
// utils/cohorts/userCohorts.ts ("the page-banner iframe cannot read
// accountId synchronously") and worked around the same way in
// utils/firstSeen/firstSeenPing.ts: a per-browser localStorage marker is
// this codebase's established proxy for "per user" client-side state.
// Practical effect: two Confluence accounts sharing one browser profile
// share the marker (auto-open fires for the first of them only). Accepted
// as consistent with existing precedent rather than a new gap.
function keyFor(cloudId: string, diagramType: string): string {
  return `zenuml.starterGalleryAutoOpened.${cloudId}.${diagramType}`;
}

export function hasAutoOpenedStarterGallery(cloudId: string, diagramType: string): boolean {
  try {
    return localStorage.getItem(keyFor(cloudId, diagramType)) === '1';
  } catch {
    // localStorage unavailable (private browsing, restrictive iframe) — treat
    // as "not yet shown" so the surface still gets one auto-open attempt.
    return false;
  }
}

export function markStarterGalleryAutoOpened(cloudId: string, diagramType: string): void {
  try {
    localStorage.setItem(keyFor(cloudId, diagramType), '1');
  } catch {
    // Storage full/disabled — silently skip. Worst case the gallery
    // auto-opens again next session, which is not a data-loss risk.
  }
}
