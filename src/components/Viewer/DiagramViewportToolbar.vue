<template>
  <Teleport :to="headerTarget || 'body'" :disabled="!headerTarget">
  <div class="diagram-viewport-toolbar" :class="{ 'diagram-viewport-toolbar--header': !!headerTarget }" role="toolbar" :aria-label="`${label} zoom controls`">
    <button type="button" class="diagram-viewport-button" :disabled="headerTarget && !ready" aria-label="Zoom out" :title="`Zoom out (${wheelShortcut})`" @click="emitAction('zoom_out')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="headerTarget" d="M5 12h14"/><template v-else><circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M15.2 15.2 21 21"/></template></svg>
    </button>
    <button type="button" class="diagram-viewport-button" :disabled="headerTarget && !ready" aria-label="Zoom in" :title="`Zoom in (${wheelShortcut})`" @click="emitAction('zoom_in')">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path v-if="headerTarget" d="M5 12h14M12 5v14"/><template v-else><circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M10.5 7.5v6M15.2 15.2 21 21"/></template></svg>
    </button>
    <template v-if="headerTarget">
      <button type="button" class="diagram-viewport-button diagram-viewport-button--fit" aria-label="Fit height" title="Fit height" :disabled="!ready" @click="emitAction('fit_height')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16M4 21h16M12 6v12M8 10l4-4 4 4M8 14l4 4 4-4"/></svg>
      </button>
      <button type="button" class="diagram-viewport-button" aria-label="Fit width" title="Fit width" :disabled="!ready" @click="emitAction('fit_width')">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 4v16M21 4v16M6 12h12M10 8l-4 4 4 4M14 8l4 4-4 4"/></svg>
      </button>
    </template>
  </div>
  </Teleport>
</template>

<script>
/**
 * Shared zoom controls. A visible viewer header hosts four actions; a
 * chrome-less/editor preview retains the original two-button floating chip.
 *
 * Separate from DiagramViewport because the two buttons outlived that component's
 * one engine: Mermaid and PlantUML zoom through svg-pan-zoom, Graph through
 * mxGraph's own `graph.zoomIn/zoomOut`. Same control, same event, same place on
 * the surface — only the thing being zoomed differs, so the parent handles the
 * emitted action and this stays presentational.
 */
import { VIEWER_ZOOM_HEADER } from '@/utils/viewport/headerZoom';
import { trackViewportControl } from '@/utils/viewport/trackViewportControl';

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
  inject: { zoomHeader: { from: VIEWER_ZOOM_HEADER, default: null } },
  props: {
    ready: { type: Boolean, default: true },
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
  emits: ['zoom-in', 'zoom-out', 'fit-height', 'fit-width'],
  watch: {
    headerTarget() { this.zoomHeader?.changed(); },
  },
  computed: {
    headerTarget() { return this.zoomHeader?.target.value ?? null; },
    // A module constant, exposed for the template rather than kept in `data`,
    // where Vue would make it reactive for nothing.
    wheelShortcut() {
      return WHEEL_SHORTCUT;
    },
  },
  methods: {
    emitAction(viewportAction) {
      if (this.headerTarget && !this.ready) return;
      this.$emit(viewportAction.replace('_', '-'));
      trackViewportControl({
        macroType: this.macroType,
        viewportAction,
        viewportInput: 'toolbar',
        isDisplayMode: this.$store.getters.isDisplayMode,
        ...(this.headerTarget ? { controlLocation: 'header' } : {}),
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

<style scoped>
.diagram-viewport-toolbar--header {
  position: static;
  width: 128px;
  height: 32px;
  flex-shrink: 0;
  gap: 0;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: #F9FAFB;
  box-shadow: none;
}
.diagram-viewport-toolbar--header .diagram-viewport-button { flex: 0 0 32px; position: relative; }
.diagram-viewport-button--fit::before {
  content: ''; position: absolute; left: 0; top: 8px; height: 16px; width: 1px; background: #E5E7EB;
}
.diagram-viewport-button:disabled { opacity: .4; cursor: not-allowed; }
.diagram-viewport-button:disabled:hover { background: transparent; }
</style>
