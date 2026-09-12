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
    <DiagramViewportToolbar
      v-if="isInteractive"
      :macro-type="macroType"
      :label="label"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
    />
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
 * Graph (DrawIO) does NOT use it — mxGraph's GraphViewer owns its own layout and
 * ships `graph.zoomIn/zoomOut` plus `setPanning`, so ForgeGraphViewer drives those
 * directly behind the same DiagramViewportToolbar. Sequence (ZenUML) renders HTML,
 * not SVG, and would need a CSS-transform controller.
 */
import svgPanZoom from 'svg-pan-zoom';
import Hammer from 'hammerjs';
import DiagramViewportToolbar from '@/components/Viewer/DiagramViewportToolbar.vue';
import { hasSvgLayout } from '@/utils/mermaid/viewportLayout';
import { createWheelStepper, isZoomIntent } from '@/utils/viewport/wheelZoom';

/** A CSS length in px, or null for `none`, a percentage, or anything else. */
function readPxLength(value) {
  const match = /^([\d.]+)px$/.exec(String(value).trim());
  return match ? Number(match[1]) : null;
}

export default {
  name: 'DiagramViewport',
  components: { DiagramViewportToolbar },
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
      wheelHandler: null,
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
  },
  mounted() {
    this.bindWheelZoom();
  },
  beforeUnmount() {
    this.unbindWheelZoom();
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
      // svg-pan-zoom inverts the SVG's screen matrix during setup. A renderer can
      // finish before its Forge iframe has layout, leaving that matrix singular
      // (a 0 x 0 SVG) and throwing InvalidStateError. Wait for layout rather than
      // turning a transient host state into a render crash.
      const svgRect = svgElement.getBoundingClientRect();
      if (!hasSvgLayout(svgRect)) {
        this.observeLayout(svgElement);
        return;
      }
      this.captureInlineSize(svgElement, svgRect);
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
        // Off in favour of bindWheelZoom(): svg-pan-zoom zooms on a plain wheel
        // with no option to require a modifier, which is how a Mermaid or
        // PlantUML diagram used to swallow the page's scroll.
        mouseWheelZoomEnabled: false,
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
    /** Re-try the attach once the host gives the SVG a box to measure. */
    observeLayout(svgElement) {
      if (typeof ResizeObserver === 'undefined' || !this.$refs.viewport) return;
      this.panZoomResizeObserver = new ResizeObserver(() => {
        if (!hasSvgLayout(svgElement.getBoundingClientRect())) return;
        this.panZoomResizeObserver?.disconnect();
        this.panZoomResizeObserver = null;
        void this.attach();
      });
      this.panZoomResizeObserver.observe(this.$refs.viewport);
    },
    /**
     * Ctrl/Cmd + wheel to zoom, the rule all four diagram types share.
     *
     * Bound to the viewport rather than handed to svg-pan-zoom because its own
     * `mouseWheelZoomEnabled` cannot be told to require a modifier. Bound once on
     * mount rather than per attach(): the element outlives every re-render, and
     * `panZoom` is read at call time, so a diagram that has not attached yet (or
     * has detached) simply does nothing.
     *
     * Zooms about the box centre, like the toolbar buttons and the other two
     * engines, rather than svg-pan-zoom's old zoom-at-pointer.
     */
    bindWheelZoom() {
      const viewport = this.$refs.viewport;
      if (!viewport || !this.isInteractive || this.wheelHandler) return;
      const step = createWheelStepper((direction) => {
        if (direction > 0) this.panZoom?.zoomIn();
        else this.panZoom?.zoomOut();
      });
      this.wheelHandler = (event) => {
        if (!this.panZoom || !isZoomIntent(event)) return;
        event.preventDefault();
        step(event, viewport.clientHeight);
      };
      // Not passive: a zoom has to take the event away from page scroll. Only
      // the zoom branch above does, so an ungated wheel still reaches the page.
      viewport.addEventListener('wheel', this.wheelHandler, { passive: false });
    },
    unbindWheelZoom() {
      if (!this.wheelHandler) return;
      this.$refs.viewport?.removeEventListener('wheel', this.wheelHandler);
      this.wheelHandler = null;
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
    captureInlineSize(svgElement, svgRect) {
      if (!this.isDisplayMode || this.isFullscreenMode) return;
      const viewBox = svgElement.viewBox?.baseVal;
      // svgRect is known to have layout: attach() returns early otherwise.
      this.inlineAspectRatio = viewBox?.width > 0 && viewBox?.height > 0
        ? viewBox.width / viewBox.height
        : svgRect.width / svgRect.height;
      // Nothing is ever drawn larger than natural size, so the box is capped at
      // the diagram's own width. Mermaid states that width as an inline
      // `max-width: <n>px`; PlantUML's is a stylesheet `max-width: 100%`, i.e. no
      // cap at all, so its natural width comes from the viewBox instead. (Only a
      // px value counts here -- parseFloat on "100%" would read 100 and squeeze a
      // 322px diagram into a 100px box.)
      this.inlineMaxWidth = readPxLength(getComputedStyle(svgElement).maxWidth)
        ?? (viewBox?.width > 0 ? viewBox.width : null);
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
      this.clampUpscale();
      this.panZoomDirty = false;
    },
    /**
     * `fit: true` scales to fill the container in BOTH axes, so a small diagram in
     * a big box is enlarged rather than fitted. A 247x188 PlantUML sequence came
     * out at 1.4x in a 1218x850 editor pane and 2.4x in a 760px page column --
     * comically large type next to the source it was typed from, and different on
     * every surface.
     *
     * Opening a diagram is not a request to magnify it. The initial view never
     * goes past 1:1 anywhere, so the editor preview predicts the published page
     * and both show what the author drew; the + button is there for anyone who
     * wants more. Shrinking is untouched -- a diagram too wide for its box still
     * fits itself in.
     */
    clampUpscale() {
      const realZoom = this.panZoom?.getSizes?.().realZoom;
      if (!(realZoom > 1)) return;
      this.panZoom.zoom(this.panZoom.getZoom() / realZoom);
    },
    zoomIn() {
      this.panZoom?.zoomIn();
    },
    zoomOut() {
      this.panZoom?.zoomOut();
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

</style>
