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

const props = defineProps<{ attribution: DiagramAttribution | null; macroType: string; ready: boolean }>();
const root = ref<HTMLElement>();
const names = ref<Record<string, string>>({});
const summary = ref<DiagramImpactSummary>();
let observer: IntersectionObserver | undefined;
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
  try {
    const registeredSummary = await registerDiagramImpactView(props.attribution.customContentId);
    summary.value = {
      ...summary.value,
      ...registeredSummary,
      viewerRelation: summary.value?.viewerRelation ?? 'viewer',
    };
    trackAnalyticsEvent('diagram_audience_registration_succeeded', { feature_area: 'diagram_impact', surface: 'viewer', macro_type: props.macroType as any });
  } catch {
    trackAnalyticsEvent('diagram_audience_registration_failed', { feature_area: 'diagram_impact', surface: 'viewer', macro_type: props.macroType as any });
  }
}
function clearTimer() { if (timer) clearTimeout(timer); timer = undefined; }
function refreshTimer(visible: boolean) {
  clearTimer();
  if (visible && props.ready && document.visibilityState === 'visible') timer = setTimeout(qualify, 3000);
}
function onVisibility() {
  if (document.visibilityState !== 'visible') clearTimer();
  else refreshTimer(intersecting);
}

onMounted(async () => {
  await Promise.all([resolveNames(), loadSummary()]);
  if (createdBy.value || lastUpdatedBy.value || summary.value) {
    trackAnalyticsEvent('diagram_attribution_shown', { feature_area: 'diagram_impact', surface: 'viewer', macro_type: props.macroType as any, has_last_updated_by: Boolean(lastUpdatedBy.value), has_audience_count: Boolean(summary.value) });
  }
  if (root.value && typeof IntersectionObserver !== 'undefined') {
    observer = new IntersectionObserver(entries => {
      intersecting = Boolean(entries[0]?.isIntersecting);
      refreshTimer(intersecting);
    }, { threshold: 0.5 });
    observer.observe(root.value);
  }
  document.addEventListener('visibilitychange', onVisibility);
});
watch(() => props.ready, () => refreshTimer(Boolean(root.value)));
onBeforeUnmount(() => { clearTimer(); observer?.disconnect(); document.removeEventListener('visibilitychange', onVisibility); });
</script>

<style scoped>
.diagram-attribution { padding: 8px 12px; color: #6b7280; font-size: 12px; text-align: right; }
</style>
