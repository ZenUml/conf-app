<template>
  <div class="diagram-viewport-toolbar" role="toolbar" :aria-label="`${label} zoom controls`">
    <button type="button" class="diagram-viewport-button" aria-label="Zoom out" :title="`Zoom out (${WHEEL_SHORTCUT})`" @click="emitAction('zoom_out')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M15.2 15.2 21 21"/></svg>
    </button>
    <button type="button" class="diagram-viewport-button" aria-label="Zoom in" :title="`Zoom in (${WHEEL_SHORTCUT})`" @click="emitAction('zoom_in')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M10.5 7.5v6M15.2 15.2 21 21"/></svg>
    </button>
  </div>
</template>

<script>
/**
 * The floating zoom chip, and the analytics behind it.
 *
 * Separate from DiagramViewport because the two buttons outlived that component's
 * one engine: Mermaid and PlantUML zoom through svg-pan-zoom, Graph through
 * mxGraph's own `graph.zoomIn/zoomOut`. Same control, same event, same place on
 * the surface — only the thing being zoomed differs, so the parent handles the
 * emitted action and this stays presentational.
 */
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { viewportSurface } from '@/utils/viewport/surface';

/**
 * The wheel gesture, spelled for a tooltip. Both platforms in one string
 * rather than sniffing the OS -- the house convention (AdvocacyButton.vue) --
 * and the tooltip is where someone who already reached for the zoom buttons
 * learns there is a faster way. `aria-label` stays the bare action: a screen
 * reader announcing a mouse gesture on every focus is noise.
 */
const WHEEL_SHORTCUT = '\u2318/Ctrl + scroll';

export default {
  name: 'DiagramViewportToolbar',
  props: {
    /** Analytics `macro_type` — the renderer this toolbar is driving. */
    macroType: {
      type: String,
      required: true,
    },
    /** Human name used in the accessible label, e.g. "Mermaid zoom controls". */
    label: {
      type: String,
      required: true,
    },
  },
  emits: ['zoom-in', 'zoom-out'],
  data() {
    return { WHEEL_SHORTCUT };
  },
  computed: {
    surface() {
      return viewportSurface(this.$store.getters.isDisplayMode);
    },
  },
  methods: {
    emitAction(viewportAction) {
      this.$emit(viewportAction === 'zoom_in' ? 'zoom-in' : 'zoom-out');
      trackAnalyticsEvent('viewport_control_used', {
        feature_area: 'macro',
        surface: this.surface,
        macro_type: this.macroType,
        viewport_action: viewportAction,
      });
    },
  },
};
</script>

<style scoped>
.diagram-viewport-toolbar {
  position: absolute;
  z-index: 2;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  border: 1px solid #d9d7d2;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 2px 8px rgba(9, 30, 66, 0.18);
}

.diagram-viewport-button {
  display: inline-flex;
  width: 32px;
  height: 32px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 6px;
  color: #44546f;
  background: transparent;
  cursor: pointer;
}

.diagram-viewport-button:hover {
  color: #172b4d;
  background: #f1f2f4;
}

.diagram-viewport-button:focus-visible {
  outline: 2px solid #0c66e4;
  outline-offset: 1px;
}

.diagram-viewport-button svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
