<template>
  <div v-if="visible" class="second-diagram-prompt" data-testid="second-diagram-prompt">
    <span class="second-diagram-prompt-text">Have another diagram to add?</span>
    <button
      type="button"
      class="second-diagram-prompt-btn"
      data-testid="second-diagram-prompt-cta"
      @click="onClick"
    >
      Start a new diagram
    </button>
  </div>
</template>

<script setup lang="ts">
/**
 * Onboarding funnel — "second diagram" viewer prompt.
 *
 * 33.6% of tenants that create a first diagram never create a second
 * (Mixpanel macro_create_succeeded, 2026-05-18..2026-08-17). This is a
 * low-weight invitation to make the next one, shown in the VIEWER (not the
 * editor — the editor unmounts on publish, so an editor-side success state
 * has no reliable render window; the next render of this macro after a
 * publish IS the viewer).
 *
 * Gated by a build-time constant (VITE_SECOND_DIAGRAM_PROMPT_ENABLED, set in
 * vite.config.mjs's `define` block, default OFF) — deliberately NOT a Forge
 * feature flag: Lite is at the Developer Console's 10-flags-per-app cap and
 * a new flag needs a deletion first, which is the product owner's call.
 *
 * Display conditions (all must hold):
 *  1. The build-time constant is on.                          [implemented]
 *  2. The current user authored the diagram being viewed.     [implemented
 *     — DiagramAttribution.createdByAccountId === currentAccountId, both
 *     already resolved by the parent viewer with no new backend call.]
 *  3. The page holds exactly one diagram macro.                [NOT
 *     implemented — determining this in the viewer requires a full-page ADF
 *     scan via the Confluence REST API. That same scan was deliberately
 *     removed from the viewer's load path in PR #370 (2026-07-19) for
 *     performance (fetch p50 -48..-55%; see
 *     docs/adr and the project's PR #370 history) — same-page-duplicate
 *     detection is now edit/config-surface only. Reintroducing it here would
 *     regress every macro's viewer load again, not just the ones eligible
 *     for this prompt. This condition is therefore left unenforced: the
 *     prompt can show on a page with more than one diagram macro.]
 */
import { computed, ref, watch } from 'vue';
import type { DiagramAttribution } from '@/model/DiagramAttribution';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import globals from '@/model/globals';
import { getSpaceKey, NO_SPACE_CONTEXT } from '@/utils/ContextParameters/ContextParameters';

const props = defineProps<{
  attribution: DiagramAttribution | null;
  macroType: string;
  ready: boolean;
  /** Current viewer's Forge accountId, resolved by the parent via getContext(). */
  currentAccountId: string | null | undefined;
  /**
   * Storybook/design-review-only escape hatch: overrides the build-time
   * constant so the affordance can be rendered on demand without a
   * VITE_SECOND_DIAGRAM_PROMPT_ENABLED rebuild. No production call site
   * passes this — GenericViewer.vue never sets it, so production behavior
   * is governed solely by the build-time constant, unchanged.
   */
  forceEnabled?: boolean;
}>();

const shown = ref(false);

const enabled = computed(() =>
  props.forceEnabled ?? (import.meta.env.VITE_SECOND_DIAGRAM_PROMPT_ENABLED === 'true'),
);

const isCreator = computed(() =>
  !!props.attribution?.createdByAccountId
  && !!props.currentAccountId
  && props.attribution.createdByAccountId === props.currentAccountId,
);

// Condition 3 (single-macro page) is intentionally not part of this check —
// see the doc comment above.
const visible = computed(() => enabled.value && props.ready && isCreator.value);

function baseProps() {
  return {
    feature_area: 'macro' as const,
    surface: 'viewer' as const,
    macro_type: props.macroType as any,
  };
}

watch(visible, (isVisible) => {
  if (isVisible && !shown.value) {
    shown.value = true;
    trackAnalyticsEvent('macro_second_diagram_prompt_shown', baseProps());
  }
}, { immediate: true });

/**
 * Hands off to the page editor, where the user can insert a new macro (a
 * macro iframe cannot insert a sibling macro into an already-published page
 * on its own). Same navigation shape as BylineDiagrams.vue's
 * onOpenEditorToPaste — best-effort: a failed/unavailable navigation still
 * leaves the click tracked, and never throws into the caller.
 */
async function onClick() {
  trackAnalyticsEvent('macro_second_diagram_prompt_clicked', baseProps());
  try {
    if (!globals.apWrapper) return; // standalone/dev — no navigation target
    const spaceKey = getSpaceKey();
    if (!spaceKey || spaceKey === NO_SPACE_CONTEXT) return;
    const pageId = await globals.apWrapper._getCurrentPageId();
    if (!pageId) return;
    const { router } = await import('@forge/bridge');
    await router.navigate(`/wiki/spaces/${spaceKey}/pages/edit-v2/${pageId}`);
  } catch (e) {
    console.error('[second-diagram-prompt] editor navigation failed', e);
  }
}
</script>

<style scoped>
.second-diagram-prompt {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 8px 12px;
  color: #6b7280;
  font-size: 12px;
}
.second-diagram-prompt-btn {
  border: 1px solid #d1d5db;
  background: transparent;
  color: #172b4d;
  border-radius: 4px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
}
.second-diagram-prompt-btn:hover {
  background: #f4f5f7;
}
</style>
