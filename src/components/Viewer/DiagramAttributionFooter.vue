<template>
  <footer v-if="attribution" ref="root" class="diagram-attribution" data-testid="diagram-attribution">
    <span v-if="createdBy">Created by {{ createdBy }}</span>
    <span v-if="lastUpdatedBy && lastUpdatedBy !== createdBy"> · Last updated by {{ lastUpdatedBy }}</span>
    <span v-if="summary && summary.audienceCount > 0"> · {{ summary.audienceCount }} view{{ summary.audienceCount === 1 ? '' : 's' }}</span>
  </footer>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { DiagramAttribution } from '@/model/DiagramAttribution';
import { forgeRequest } from '@/utils/requestUtil';
import { getDiagramImpact, registerDiagramImpactView, type DiagramImpactSummary } from '@/services/DiagramImpact';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { DWELL_GATE_THRESHOLDS, qualifiesForDwell } from '@/components/Viewer/diagramDwellGate';
import { getGateTelemetry } from '@/utils/renderGate/maybeGateViewerRender';

const props = defineProps<{
  attribution: DiagramAttribution | null;
  macroType: string;
  ready: boolean;
  // The diagram itself. The gate observed the 29px footer until 2026-09-02,
  // so a tall diagram read in full registered nothing: measured over 19 days
  // and four tenants, 4,429 of 41,844 rendered footers (10.6%) ever reached
  // the 3s dwell, and the rate split 4.2% (sequence) to 26.0% (graph) by how
  // tall the macro tends to be. Optional so a caller without a diagram node
  // keeps the old target rather than losing the gate entirely.
  diagramHost?: () => HTMLElement | null;
}>();
const root = ref<HTMLElement>();
const names = ref<Record<string, string>>({});
const summary = ref<DiagramImpactSummary>();
let observer: IntersectionObserver | undefined;
// Which element the gate ended up watching. `getCaptureNode()` returns null
// while the load-failed panel is mounted, and the `?? root.value` fallback
// would then silently restore the 29px footer target this release replaces.
// The value rides the registration events so that reversion is visible in
// production instead of being indistinguishable from the fix working.
let gateTarget: 'diagram' | 'footer' = 'footer';
let timer: ReturnType<typeof setTimeout> | undefined;
let registered = false;
let intersecting = false;

const createdBy = computed(() => props.attribution?.createdByAccountId && names.value[props.attribution.createdByAccountId]);
const lastUpdatedBy = computed(() => props.attribution?.lastUpdatedByAccountId && names.value[props.attribution.lastUpdatedByAccountId]);

async function resolveNames() {
  const ids = [...new Set([props.attribution?.createdByAccountId, props.attribution?.lastUpdatedByAccountId].filter(Boolean))] as string[];
  await Promise.all(ids.map(async id => {
    try {
      const user = await forgeRequest(`/wiki/rest/api/user?accountId=${encodeURIComponent(id)}`);
      names.value[id] = user?.displayName || '';
    } catch { /* attribution remains quietly unavailable */ }
  }));
}

async function loadSummary() {
  if (!props.attribution) return;
  try { summary.value = await getDiagramImpact(props.attribution.customContentId); } catch { /* non-critical */ }
}

async function qualify() {
  if (registered || !props.attribution || document.visibilityState !== 'visible') return;
  registered = true;
  // Which path armed the timer. `false` means the ready-watcher fired it with
  // no viewport check, the over-count this release removes; the property makes
  // the size of that population readable before and after.
  const wasIntersecting = intersecting;
  try {
    const registeredSummary = await registerDiagramImpactView(props.attribution.customContentId);
    summary.value = {
      ...summary.value,
      audienceCount: registeredSummary.audienceCount,
      viewerRelation: summary.value?.viewerRelation ?? 'viewer',
    };
    if (registeredSummary.result === 'write_failed') {
      // 200, but no row was written. Counting it as a success would overstate
      // registrations by exactly the population that failed to register.
      trackAnalyticsEvent('diagram_audience_registration_failed', { feature_area: 'diagram_impact', surface: 'viewer', macro_type: props.macroType as any, was_intersecting: wasIntersecting, gate_target: gateTarget, ...getGateTelemetry() });
      return;
    }
    trackAnalyticsEvent('diagram_audience_registration_succeeded', { feature_area: 'diagram_impact', surface: 'viewer', macro_type: props.macroType as any, was_intersecting: wasIntersecting, gate_target: gateTarget, ...getGateTelemetry() });
  } catch {
    trackAnalyticsEvent('diagram_audience_registration_failed', { feature_area: 'diagram_impact', surface: 'viewer', macro_type: props.macroType as any, was_intersecting: wasIntersecting, gate_target: gateTarget, ...getGateTelemetry() });
  }
}
function clearTimer() { if (timer) clearTimeout(timer); timer = undefined; }
function refreshTimer(visible: boolean) {
  clearTimer();
  if (visible && props.ready && document.visibilityState === 'visible') timer = setTimeout(qualify, 3000);
}
/**
 * Idempotent on the target: re-running while already watching the diagram is a
 * no-op, so the `ready` watcher can call it to pick up a capture node that was
 * not yet in `$refs` at mount without churning the observer every time.
 */
function attachObserver() {
  if (typeof IntersectionObserver === 'undefined') return;
  const diagram = props.diagramHost?.() ?? null;
  const next: 'diagram' | 'footer' = diagram ? 'diagram' : 'footer';
  const target = diagram ?? root.value;
  if (!target) return;
  if (observer && next === gateTarget) return;
  observer?.disconnect();
  gateTarget = next;
  observer = new IntersectionObserver(entries => {
    const entry = entries[entries.length - 1];
    if (!entry) return;
    intersecting = qualifiesForDwell(entry);
    refreshTimer(intersecting);
  }, { threshold: DWELL_GATE_THRESHOLDS });
  observer.observe(target);
}

function onVisibility() {
  if (document.visibilityState !== 'visible') clearTimer();
  else refreshTimer(intersecting);
}

onMounted(async () => {
  await Promise.all([resolveNames(), loadSummary()]);
  if (createdBy.value || lastUpdatedBy.value || summary.value) {
    // The denominator of the audience funnel. Without the render gate on it, a
    // shown count cannot be read as a chance to register: measured
    // 2026-08-15..09-02 on the two customer tenants, 54.8% of `macro_viewed`
    // carried `render_gate: 'background'` with `visible_at_boot: false`, and
    // only 18.4% involved the macro entering the viewport at all. The 10.6%
    // registration rate (4,429 of 41,844) cannot be interpreted until the
    // off-screen share of that 41,844 is known. `{}` on an ungated render.
    trackAnalyticsEvent('diagram_attribution_shown', { feature_area: 'diagram_impact', surface: 'viewer', macro_type: props.macroType as any, has_last_updated_by: Boolean(lastUpdatedBy.value), has_audience_count: Boolean(summary.value), ...getGateTelemetry() });
  }
  attachObserver();
  document.addEventListener('visibilitychange', onVisibility);
});
// Was `refreshTimer(Boolean(root.value))`, which is true whenever the footer
// element exists. The 3s timer therefore armed with no viewport check at all,
// and qualify() only tests document.visibilityState, so a diagram that never
// entered the viewport could register.
watch(() => props.ready, () => {
  // The capture node can reach $refs after this component mounts, so re-resolve
  // the target here before re-arming.
  attachObserver();
  refreshTimer(intersecting);
});
onBeforeUnmount(() => { clearTimer(); observer?.disconnect(); document.removeEventListener('visibilitychange', onVisibility); });
</script>

<style scoped>
.diagram-attribution { padding: 8px 12px; color: #6b7280; font-size: 12px; text-align: right; }
</style>
