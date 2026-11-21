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
      :ready="!!panZoom"
      :can-zoom-in="room.in"
      :can-zoom-out="room.out"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
      @fit-height="fitAxis('height')"
      @fit-width="fitAxis('width')"
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
import {
  alignOf, axisOffset, bindSafariPinch, classifyWheel, createGestureGate, zoomLimits, zoomRoom,
} from '@/utils/viewport/wheelZoom';
import { trackViewportControl } from '@/utils/viewport/trackViewportControl';
import { TOOLBAR_ZOOM_STEP } from '@/utils/viewport/zoomStep';
import { endFullscreenZoomSession, rebaseFullscreenZoom, startFullscreenZoomSession } from '@/utils/viewport/fullscreenZoomSummary';
import { wheelFallsThroughToPage } from '@/utils/viewport/surface';

/**
 * svg-pan-zoom's own limits, relative to its fit. Wide while reset() lays the
 * diagram out (zoom(0.875) and clampUpscale must not be clipped by the last
 * diagram's limits); applyLimits() then narrows them to opening..natural size.
 */
const LAYOUT_MIN_ZOOM = 0.01;
const LAYOUT_MAX_ZOOM = 100;

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
      unbindPinch: null,
      // Where a diagram smaller than the box sits in it (0 start .. 1 end).
      alignX: 0.5,
      alignY: 0.5,
      // svg-pan-zoom's relative zoom and the limits applyLimits() set, mirrored
      // for the toolbar: Zoom in is disabled at the ceiling, Zoom out at the floor.
      zoomRelative: 1,
      zoomMin: 0,
      zoomMax: Infinity,
      inlineAspectRatio: null,
      inlineMaxWidth: null,
      // Mermaid inline edit: see holdView().
      viewHeld: false,
    };
  },
  computed: {
    room() {
      return zoomRoom(this.zoomRelative, { min: this.zoomMin, max: this.zoomMax });
    },
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
    endFullscreenZoomSession();
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
        maxZoom: LAYOUT_MAX_ZOOM,
        minZoom: LAYOUT_MIN_ZOOM,
        // Off in favour of bindWheelZoom(): svg-pan-zoom zooms on a plain wheel
        // with no option to require a modifier, which is how a Mermaid or
        // PlantUML diagram used to swallow the page's scroll.
        mouseWheelZoomEnabled: false,
        onPan: () => { this.panZoomDirty = true; },
        onZoom: (zoom) => {
          this.panZoomDirty = true;
          this.zoomRelative = zoom;
        },
        panEnabled: true,
        zoomEnabled: true,
      });
      this.panZoomSvg = svgElement;
      this.panZoom.disableDblClickZoom();
      if (this.viewHeld) {
        // Inline edit session: the caller restores zoom and pan right
        // after this returns, in the same task. No refit, no limits, and dirty
        // so the ResizeObserver's first callback does not reset() either.
        this.releaseLimits();
        this.panZoomDirty = true;
      } else {
        this.reset();
      }
      // No-op outside Fullscreen; see fullscreenZoomSummary.ts.
      startFullscreenZoomSession({
        macroType: this.macroType,
        readScale: () => this.panZoom?.getSizes().realZoom ?? 1,
      });

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
     * The wheel rule all four diagram types share (see `classifyWheel`): on the
     * page viewer only Ctrl/Cmd + wheel zooms and a plain wheel scrolls the
     * page; in Fullscreen and the editor preview a plain wheel zooms and Shift
     * or a sideways swipe pans. Zoom is at the pointer.
     *
     * Bound to the viewport rather than handed to svg-pan-zoom because its own
     * `mouseWheelZoomEnabled` cannot be told to require a modifier. Bound once on
     * mount rather than per attach(): the element outlives every re-render, and
     * `panZoom` is read at call time, so a diagram that has not attached yet (or
     * has detached) simply does nothing.
     */
    bindWheelZoom() {
      const viewport = this.$refs.viewport;
      if (!viewport || !this.isInteractive || this.wheelHandler) return;
      const startsGesture = createGestureGate();
      this.wheelHandler = (event) => {
        if (!this.panZoom) return;
        const action = classifyWheel(event, {
          plainWheelZooms: !wheelFallsThroughToPage(this.isDisplayMode),
          pageHeight: viewport.clientHeight,
          pageWidth: viewport.clientWidth,
        });
        // A plain wheel on the page viewer is the page's to scroll.
        if (action.kind === 'pass') return;
        event.preventDefault();
        if (action.kind === 'pan') {
          this.panZoom.panBy({ x: action.dx, y: action.dy });
          return;
        }
        this.zoomAtClient(action.factor, event.clientX, event.clientY);
        // One event per gesture, not per wheel event: the gate stays shut for
        // the rest of a continuous scroll, so a wheel zoom costs the same one
        // event as a button click and the two can be compared.
        if (!startsGesture()) return;
        trackViewportControl({
          macroType: this.macroType,
          viewportAction: action.factor > 1 ? 'zoom_in' : 'zoom_out',
          viewportInput: 'wheel',
          wheelModifier: action.modifier,
          isDisplayMode: this.isDisplayMode,
        });
      };
      // Not passive: a zoom has to take the event away from page scroll. Only
      // the zoom and pan branches do, so a page-viewer plain wheel still scrolls.
      viewport.addEventListener('wheel', this.wheelHandler, { passive: false });
      this.unbindPinch = bindSafariPinch(viewport, (factor, clientX, clientY) => {
        if (this.panZoom) this.zoomAtClient(factor, clientX, clientY);
      });
    },
    /** Zoom keeping the SVG point under (clientX, clientY) under it. */
    zoomAtClient(factor, clientX, clientY) {
      const rect = this.panZoomSvg?.getBoundingClientRect();
      if (!rect) return;
      this.panZoom.zoomAtPointBy(factor, { x: clientX - rect.left, y: clientY - rect.top });
    },
    unbindWheelZoom() {
      if (!this.wheelHandler) return;
      this.$refs.viewport?.removeEventListener('wheel', this.wheelHandler);
      this.wheelHandler = null;
      this.unbindPinch?.();
      this.unbindPinch = null;
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
      // Lay out with no limits in the way; applyLimits() sets them from the result.
      this.panZoom.setBeforePan(null);
      this.panZoom.setMinZoom(LAYOUT_MIN_ZOOM);
      this.panZoom.setMaxZoom(LAYOUT_MAX_ZOOM);
      this.panZoom.reset();
      // Match Mermaid Live: leave breathing room for the floating toolbar — but
      // only on the surfaces whose box is bigger than the drawing. The inline box
      // is sized to the diagram's own ratio, so shrinking there would render every
      // diagram on the page 12.5% smaller than it did before this viewport existed.
      if (this.isFullscreenMode || !this.isDisplayMode) this.panZoom.zoom(0.875);
      this.clampUpscale();
      this.applyLimits();
      this.panZoomDirty = false;
      rebaseFullscreenZoom();
    },
    /**
     * Zoom from the opening size up to natural size (see `zoomLimits`), and keep
     * the diagram in view when panned (see `axisOffset`).
     *
     * svg-pan-zoom's min/max are relative to its own fit, not to natural size,
     * so they are converted here: `realZoom` is SVG pixels per natural pixel,
     * `getZoom()` the same state relative to the fit. The pan limit goes in
     * after the opening layout, so the opening position is untouched by it.
     */
    applyLimits(openScale) {
      const sizes = this.panZoom.getSizes();
      const real = sizes?.realZoom;
      const relative = this.panZoom.getZoom();
      if (!(real > 0) || !(relative > 0)) return;
      // The current view is always inside the limits, so nothing jumps.
      const limits = zoomLimits(openScale > 0 ? openScale : real);
      const min = Math.min(limits.min, real);
      const max = Math.max(limits.max, real);
      this.zoomMin = min * relative / real;
      this.zoomMax = max * relative / real;
      this.zoomRelative = relative;
      this.panZoom.setMinZoom(this.zoomMin);
      this.panZoom.setMaxZoom(this.zoomMax);
      const viewBox = sizes.viewBox;
      if (viewBox?.width > 0 && sizes.width > 0) {
        const pan = this.panZoom.getPan();
        this.alignX = alignOf(pan.x + viewBox.x * real, viewBox.width * real, sizes.width);
        this.alignY = alignOf(pan.y + viewBox.y * real, viewBox.height * real, sizes.height);
      }
      this.panZoom.setBeforePan((_old, next) => this.limitPan(next));
    },
    /** svg-pan-zoom `beforePan`: the pan clamped so the diagram stays in view. */
    limitPan(next) {
      const sizes = this.panZoom?.getSizes();
      const viewBox = sizes?.viewBox;
      const real = sizes?.realZoom;
      if (!(viewBox?.width > 0) || !(real > 0) || !(sizes.width > 0)) return true;
      const left = viewBox.x * real;
      const top = viewBox.y * real;
      return {
        x: axisOffset(next.x + left, viewBox.width * real, sizes.width, this.alignX) - left,
        y: axisOffset(next.y + top, viewBox.height * real, sizes.height, this.alignY) - top,
      };
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
    /**
     * Mermaid inline edit: while held, attach() keeps the new SVG at
     * svg-pan-zoom's initial state instead of reset(), and zoom/pan limits are
     * off, so the caller can put the edited text back where it was on screen.
     * Releasing re-applies the opening..natural limits of the diagram now shown
     * (widened to the current view), not limits around the view the edit ended
     * in: released at natural size, those would be 1..1 and pin the zoom.
     */
    holdView(held) {
      this.viewHeld = !!held;
      if (!this.panZoom) return;
      if (this.viewHeld) this.releaseLimits();
      else this.applyLimits(this.openingScale());
    },
    /** The realZoom reset() would open the current diagram at (fit, 0.875 here, never above 1). */
    openingScale() {
      const real = this.panZoom?.getSizes().realZoom;
      const relative = this.panZoom?.getZoom();
      if (!(real > 0) || !(relative > 0)) return null;
      const fit = real / relative;
      return Math.min(1, (this.isFullscreenMode || !this.isDisplayMode) ? fit * 0.875 : fit);
    },
    releaseLimits() {
      this.panZoom.setBeforePan(null);
      this.panZoom.setMinZoom(LAYOUT_MIN_ZOOM);
      this.panZoom.setMaxZoom(LAYOUT_MAX_ZOOM);
    },
    /** SVG px per natural px (svg-pan-zoom's getZoom() is relative to its fit). */
    getRealZoom() {
      return this.panZoom?.getSizes().realZoom ?? null;
    },
    setRealZoom(realZoom) {
      const current = this.getRealZoom();
      if (!this.panZoom || !(current > 0) || !(realZoom > 0)) return;
      this.panZoom.zoom(this.panZoom.getZoom() * realZoom / current);
    },
    panByScreen(dx, dy) {
      if (this.panZoom && (dx || dy)) this.panZoom.panBy({ x: dx, y: dy });
    },
    /**
     * svg-pan-zoom keeps zoom/pan in a shadow state and writes the transform on
     * the next animation frame (ShadowViewport.updateCTMOnNextFrame), so the DOM
     * cannot be measured right after zoom()/panBy(). Write the same matrix now,
     * in the same format; the pending frame then writes an identical value.
     */
    flushView() {
      const g = this.panZoomSvg?.querySelector('.svg-pan-zoom_viewport');
      const zoom = this.panZoom?.getSizes().realZoom;
      if (!g || !(zoom > 0)) return;
      const pan = this.panZoom.getPan();
      const matrix = `matrix(${zoom},0,0,${zoom},${pan.x},${pan.y})`;
      g.setAttributeNS(null, 'transform', matrix);
      g.style.transform = matrix;
    },
    zoomIn() {
      this.panZoom?.zoomBy(TOOLBAR_ZOOM_STEP);
    },
    zoomOut() {
      this.panZoom?.zoomBy(1 / TOOLBAR_ZOOM_STEP);
    },
    fitAxis(axis) {
      if (!this.panZoom) return;
      this.panZoom.resize();
      const sizes = this.panZoom.getSizes();
      const extent = sizes.viewBox?.[axis];
      if (!(extent > 0) || !(sizes[axis] > 0) || !(sizes.realZoom > 0)) return;
      // svg-pan-zoom's public zoom is relative to its initial fit, whereas
      // realZoom maps natural SVG units to pixels. Fit just the requested axis.
      this.panZoom.zoom(this.panZoom.getZoom() * sizes[axis] / extent / sizes.realZoom);
      this.panZoom.center();
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
