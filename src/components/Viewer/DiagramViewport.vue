<template>
  <div
    ref="viewport"
    class="diagram-viewport"
    :class="{
      'diagram-viewport--interactive': isInteractive,
      'diagram-viewport--fullscreen': isFullscreenMode,
      'diagram-viewport--editor': !isDisplayMode,
    }"
  >
    <div ref="content" class="diagram-viewport-content" :class="contentClass" v-html="html"></div>
    <div
      v-if="isInteractive"
      class="diagram-viewport-toolbar"
      role="toolbar"
      :aria-label="`${label} zoom controls`"
    >
      <button type="button" class="diagram-viewport-button" aria-label="Zoom out" title="Zoom out" @click="zoomOut">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M15.2 15.2 21 21"/></svg>
      </button>
      <button type="button" class="diagram-viewport-button" aria-label="Zoom in" title="Zoom in" @click="zoomIn">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M10.5 7.5v6M15.2 15.2 21 21"/></svg>
      </button>
    </div>
  </div>
</template>

<script>
/**
 * Pan/zoom viewport shared by the SVG-rendering diagram types.
 *
 * The parent hands over its rendered SVG markup and calls `attach()` once it is in
 * the DOM; everything from there — svg-pan-zoom, touch gestures, the floating
 * toolbar, the surface rules, the analytics — lives here.
 *
 * Only for renderers that produce ONE inline `<svg>`: Mermaid and PlantUML.
 * Graph (DrawIO) must NOT use it — mxGraph's GraphViewer owns its own layout and
 * ships `graph.zoomIn/zoomOut/zoomTo` plus `setPanning`, so it needs a different
 * controller behind the same toolbar. Sequence (ZenUML) renders HTML, not SVG,
 * and needs a CSS-transform controller.
 */
import svgPanZoom from 'svg-pan-zoom';
import Hammer from 'hammerjs';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';

/** A CSS length in px, or null for `none`, a percentage, or anything else. */
function readPxLength(value) {
  const match = /^([\d.]+)px$/.exec(String(value).trim());
  return match ? Number(match[1]) : null;
}

export default {
  name: 'DiagramViewport',
  props: {
    /** The renderer's SVG markup, injected verbatim (both callers produce a string). */
    html: {
      type: String,
      default: null,
    },
    /** Analytics `macro_type` — the renderer this viewport is driving. */
    macroType: {
      type: String,
      required: true,
    },
    /** Human name used in the toolbar's accessible label, e.g. "Mermaid zoom controls". */
    label: {
      type: String,
      required: true,
    },
    /**
     * Classes for the wrapper the SVG is injected into. Load-bearing: the export
     * capture (captureCrop.ts) and the export-entry framing rules in
     * GenericViewer select `.plantuml-render` / `.mermaid-diagram` by name.
     */
    contentClass: {
      type: [String, Array, Object],
      default: null,
    },
  },
  data() {
    return {
      panZoom: null,
      panZoomSvg: null,
      panZoomDirty: false,
      panZoomResizeObserver: null,
      inlineAspectRatio: null,
      inlineMaxWidth: null,
    };
  },
  computed: {
    isDisplayMode() {
      return this.$store.getters.isDisplayMode;
    },
    isFullscreenMode() {
      return window.forgeGlobal?.forgeContext?.extension?.modal?.macroMode === 'fullscreen';
    },
    // The Export PNG host renders the diagram only to photograph it. Pan/zoom
    // would put a transform (and a toolbar) in the capture, so that surface keeps
    // the plain, untouched SVG.
    isInteractive() {
      const modal = window.forgeGlobal?.forgeContext?.extension?.modal;
      return modal?.openExport !== true;
    },
    surface() {
      if (this.isFullscreenMode) return 'fullscreen';
      return this.isDisplayMode ? 'viewer' : 'editor';
    },
  },
  beforeUnmount() {
    this.detach();
  },
  methods: {
    /**
     * Bind the viewport to the SVG currently rendered. Safe to call after every
     * render: it no-ops when that SVG is already bound.
     */
    async attach() {
      await this.$nextTick();
      if (!this.isInteractive) {
        this.detach();
        return;
      }
      const svgElement = this.$refs.content?.querySelector('svg');
      if (!svgElement || svgElement === this.panZoomSvg) return;

      this.detach();
      this.captureInlineSize(svgElement);
      // svg-pan-zoom removes the viewBox attribute (shadow-viewport.js), which is
      // what gave the SVG its intrinsic ratio. Without the height captured above,
      // an inline box with no height of its own collapses to the browser's 150px
      // default for a ratio-less replaced element (#650).
      svgElement.style.maxWidth = 'none';

      let hammer;
      this.panZoom = svgPanZoom(svgElement, {
        center: true,
        controlIconsEnabled: false,
        customEventsHandler: {
          haltEventListeners: ['touchstart', 'touchend', 'touchmove', 'touchleave', 'touchcancel'],
          init: (options) => {
            const instance = options.instance;
            let initialScale = 1;
            let pannedX = 0;
            let pannedY = 0;
            hammer = new Hammer(options.svgElement);
            const resetPanned = () => {
              pannedX = 0;
              pannedY = 0;
            };
            const panByGesture = (event) => {
              instance.panBy({ x: event.deltaX - pannedX, y: event.deltaY - pannedY });
              pannedX = event.deltaX;
              pannedY = event.deltaY;
            };
            hammer.get('pinch').set({ enable: true });
            hammer.on('panstart panmove', (event) => {
              if (event.type === 'panstart') resetPanned();
              panByGesture(event);
            });
            hammer.on('pinchstart pinchmove', (event) => {
              if (event.type === 'pinchstart') {
                initialScale = instance.getZoom();
                resetPanned();
              }
              instance.zoomAtPoint(initialScale * event.scale, event.center);
              panByGesture(event);
            });
          },
          destroy: () => hammer?.destroy(),
        },
        fit: true,
        maxZoom: 12,
        minZoom: 0.2,
        onPan: () => { this.panZoomDirty = true; },
        onZoom: () => { this.panZoomDirty = true; },
        panEnabled: true,
        zoomEnabled: true,
      });
      this.panZoomSvg = svgElement;
      this.panZoom.disableDblClickZoom();
      this.reset();

      if (typeof ResizeObserver !== 'undefined') {
        this.panZoomResizeObserver = new ResizeObserver(() => {
          this.syncInlineHeight();
          this.panZoom?.resize();
          if (!this.panZoomDirty) this.reset();
        });
        this.panZoomResizeObserver.observe(this.$refs.viewport);
      }
    },
    detach() {
      this.panZoomResizeObserver?.disconnect();
      this.panZoomResizeObserver = null;
      this.panZoom?.destroy();
      this.panZoom = null;
      this.panZoomSvg = null;
      this.panZoomDirty = false;
      this.inlineAspectRatio = null;
      this.inlineMaxWidth = null;
      this.$refs.viewport?.style.removeProperty('height');
      this.$refs.content?.style.removeProperty('height');
    },
    /**
     * Inline (page) only. Fullscreen has an explicit height and the editor pane
     * fills its parent, but the page viewer has no parent height to inherit — the
     * Forge macro iframe is sized by its own content — so the box has to carry the
     * diagram's own ratio, read here while the viewBox still exists.
     */
    captureInlineSize(svgElement) {
      if (!this.isDisplayMode || this.isFullscreenMode) return;
      const rect = svgElement.getBoundingClientRect();
      const viewBox = svgElement.viewBox?.baseVal;
      this.inlineAspectRatio = viewBox?.width > 0 && viewBox?.height > 0
        ? viewBox.width / viewBox.height
        : rect.width > 0 && rect.height > 0
          ? rect.width / rect.height
          : null;
      // Only a px cap counts. Mermaid states its natural width as an inline
      // `max-width: <n>px` and must not be upscaled past it; PlantUML's cap is a
      // stylesheet `max-width: 100%`, i.e. no cap at all -- it has always stretched
      // to the column, and parseFloat on "100%" would read 100 and squeeze a 322px
      // diagram into a 100px box. `null` here means "no cap": take the full width.
      this.inlineMaxWidth = readPxLength(getComputedStyle(svgElement).maxWidth);
      this.syncInlineHeight();
      this.$refs.content.style.height = '100%';
      svgElement.style.height = '100%';
    },
    syncInlineHeight() {
      if (!this.inlineAspectRatio || !this.$refs.viewport) return;
      const available = this.$refs.viewport.clientWidth;
      const width = this.inlineMaxWidth ? Math.min(available, this.inlineMaxWidth) : available;
      if (width > 0) this.$refs.viewport.style.height = `${width / this.inlineAspectRatio}px`;
    },
    reset() {
      if (!this.panZoom) return;
      this.panZoom.reset();
      // Match Mermaid Live: leave breathing room for the floating toolbar — but
      // only on the surfaces whose box is bigger than the drawing. The inline box
      // is sized to the diagram's own ratio, so shrinking there would render every
      // diagram on the page 12.5% smaller than it did before this viewport existed.
      if (this.isFullscreenMode || !this.isDisplayMode) this.panZoom.zoom(0.875);
      this.panZoomDirty = false;
    },
    zoomIn() {
      this.panZoom?.zoomIn();
      this.trackAction('zoom_in');
    },
    zoomOut() {
      this.panZoom?.zoomOut();
      this.trackAction('zoom_out');
    },
    trackAction(viewportAction) {
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
.diagram-viewport {
  position: relative;
  width: 100%;
}

/* The editor preview is a fixed-height pane, so the viewport fills it rather than
   sizing to the diagram. The parent's own root needs `height: 100%` for this chain
   to reach here — see Mermaid.vue / PlantUml.vue. */
.diagram-viewport--editor,
.diagram-viewport--editor .diagram-viewport-content {
  height: 100%;
  min-height: 0;
}

.diagram-viewport--fullscreen {
  height: max(280px, calc(100vh - 190px));
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
}

.diagram-viewport--interactive {
  overflow: hidden;
}

.diagram-viewport--fullscreen .diagram-viewport-content {
  width: 100%;
  height: 100%;
}

.diagram-viewport--interactive .diagram-viewport-content :deep(svg) {
  width: 100%;
  cursor: grab;
  touch-action: none;
}

.diagram-viewport--fullscreen .diagram-viewport-content :deep(svg),
.diagram-viewport--editor .diagram-viewport-content :deep(svg) {
  height: 100%;
}

.diagram-viewport--interactive .diagram-viewport-content :deep(svg:active) {
  cursor: grabbing;
}

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
