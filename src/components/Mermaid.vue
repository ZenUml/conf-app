<template>
  <div>
    <div v-if="!mermaidCode" class="flex flex-col items-center justify-center py-16 px-8 text-center select-none">
      <div class="text-4xl mb-3">🌿</div>
      <div class="text-sm font-semibold text-emerald-700 mb-1">Start with Mermaid</div>
      <div class="text-xs text-gray-400 mb-4">Type or paste Mermaid syntax in the editor</div>
      <pre class="text-left text-xs font-mono bg-gray-900 text-emerald-300 rounded-lg px-5 py-4 leading-relaxed">sequenceDiagram
    Alice-&gt;&gt;John: Hello John!
    John--&gt;&gt;Alice: Hi Alice!</pre>
    </div>
    <!-- No zoom outside the viewer (the editor has its own preview pane, and
         the byline dialog is a thumbnail): render exactly what shipped before. -->
    <div v-else-if="!zoomEnabled" class="flex justify-center" v-html="svg"></div>
    <div v-else class="mermaid-zoom" @keydown="onKeydown">
      <!-- The viewport clips ONLY while zoomed. At the fit level the canvas
           carries no transform at all, nothing overflows, and this element
           is a plain block wrapping the same `flex justify-center` div the
           viewer has always had — so an untouched diagram renders pixel for
           pixel as before, including its height, which the Forge iframe sizes
           itself from. A transform never affects layout, so zooming in grows
           the drawing inside the box the diagram already occupied instead of
           inflating the macro and pushing the page around. -->
      <div
        ref="viewport"
        class="mermaid-zoom-viewport"
        :style="viewportStyle"
        :class="{
          'mermaid-zoom-viewport--zoomed': isZoomed,
          'mermaid-zoom-viewport--grabbable': canPan,
          'mermaid-zoom-viewport--grabbing': isDragging,
        }"
        tabindex="0"
        role="group"
        aria-label="Diagram. Zoom with plus and minus, pan with the arrow keys, reset with 0."
        @wheel="onWheel"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
      >
        <div ref="canvas" class="mermaid-zoom-canvas flex justify-center" :style="canvasStyle" v-html="svg"></div>
      </div>
      <!-- Hidden until the diagram is hovered or focused, and pinned visible
           while zoomed. Chrome that is always on would sit permanently on top
           of every mermaid diagram in the page. -->
      <div
        v-if="!capturing"
        class="mermaid-zoom-controls"
        :class="{'mermaid-zoom-controls--pinned': isZoomed}"
        role="group"
        aria-label="Diagram zoom"
        data-testid="mermaid-zoom-controls"
      >
        <button
          type="button"
          class="mermaid-zoom-btn"
          aria-label="Zoom out"
          title="Zoom out"
          data-testid="mermaid-zoom-out"
          :disabled="!canZoomOut"
          @click="zoomOut('button')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>
        </button>
        <button
          type="button"
          class="mermaid-zoom-level"
          :aria-label="`Zoom level ${zoomLabel}. Reset to fit.`"
          title="Reset zoom"
          data-testid="mermaid-zoom-reset"
          :disabled="!isZoomed"
          @click="resetZoom('button')"
        >{{ zoomLabel }}</button>
        <button
          type="button"
          class="mermaid-zoom-btn"
          aria-label="Zoom in"
          title="Zoom in"
          data-testid="mermaid-zoom-in"
          :disabled="!canZoomIn"
          @click="zoomIn('button')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { loadMermaid } from '@/utils/mermaid/loadMermaid'
import { normalizeSvgSizing } from '@/utils/mermaid/normalizeSvgSizing'
import { normalizeMermaidWhitespace } from '@/utils/mermaid/normalizeWhitespace'
import {
  clampPan,
  clampScale,
  formatZoomLabel,
  panAfterZoom,
  roundScale,
  sameScale,
  stepScale,
} from '@/utils/mermaid/zoom'
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent'
import EventBus from "@/EventBus";
import {DiagramType} from "@/model/Diagram/Diagram";
import globals from '@/model/globals';
import { trackRenderTime } from '@/utils/analytics/trackRenderTime';
import { trackViewerRenderCrash } from '@/utils/analytics/trackViewerRenderCrash';
import { hasLayout, awaitLayout } from '@/utils/renderGate/documentLayout';
import * as renderPerf from '@/utils/analytics/renderPerf';

// How long a pan or wheel-zoom gesture has to be idle before it is reported.
// One trackpad swipe is dozens of events for a single intent.
const GESTURE_IDLE_MS = 400;

// The smallest window a zoomed diagram is explored through. A transform does
// not change layout, so a zoomed diagram is clipped to the box it already
// occupied — which is the right answer for a tall diagram (the macro keeps its
// footprint and the reader pans) and a useless one for a short wide diagram,
// the shape most likely to have been shrunk in the first place: measured in a
// 562px column, a one-row flowchart occupies 66px, and magnifying it 2x inside
// 66px is a peephole, not a zoom. So a zoomed viewport may grow — never past
// what the drawing needs, never past this, and never at all for a diagram
// already taller than it. It shrinks back on reset.
const MIN_ZOOMED_VIEWPORT_PX = 320;

export default {
  name: "Mermaid",
  data() {
    return {
      svg: null,
      renderId: null,
      // Zoom state. `naturalScale` is the level the reader is at, measured
      // against the size mermaid emitted; `fitScale` is the level the same
      // diagram draws at untouched. They start equal and stay equal until the
      // reader zooms, which is what keeps the default render identical to the
      // one that shipped before this feature (see the template comment).
      naturalScale: 1,
      fitScale: 1,
      pan: { x: 0, y: 0 },
      viewportSize: { width: 0, height: 0 },
      // The canvas's LAYOUT size, i.e. its size at the fit level. A CSS
      // transform never changes it, so this stays the honest denominator for
      // "does the zoomed drawing overflow its box".
      baseSize: { width: 0, height: 0 },
      isDragging: false,
      // True only while an export capture is in flight: the controls are
      // chrome, not diagram, and must not be rasterised into the PNG.
      capturing: false,
    }
  },
  computed: {
    mermaidCode() {
      return this.$store.state.diagram.diagramType === DiagramType.Mermaid && this.$store.state.diagram.mermaidCode;
    },
    isDisplayMode() {
      return this.$store.getters.isDisplayMode;
    },
    // The Fullscreen modal is a viewer, not an editor — ApWrapper2.isDisplayMode()
    // says so explicitly — but it is a different analytics surface.
    isFullscreen() {
      return window.forgeGlobal?.forgeContext?.extension?.modal?.macroMode === 'fullscreen';
    },
    // The contentBylineItem dialog renders a preview through DiagramPortal and
    // reports isDisplayMode() === true (there is no extension.modal there), so
    // without this it would silently inherit the viewer's zoom control AND
    // stamp its events surface:'viewer' — the exact #368 misclassification the
    // analytics catalog warns about. A byline thumbnail is not a reading
    // surface; it gets no zoom.
    isBylineSurface() {
      return /byline/.test(window.forgeGlobal?.forgeContext?.moduleKey || '');
    },
    surface() {
      return this.isFullscreen ? 'fullscreen' : 'viewer';
    },
    zoomEnabled() {
      // Read the wrapper rather than the store getter: `isDisplayMode` above
      // is a memoized Vuex getter over the same call, and this decides whether
      // a whole subtree exists, so it is worth reading from the source.
      return globals.apWrapper.isDisplayMode() && !this.isBylineSurface;
    },
    /** What the CSS transform has to do on top of the scale the SVG already draws at. */
    transformScale() {
      if (!(this.fitScale > 0)) return 1;
      return this.naturalScale / this.fitScale;
    },
    isZoomed() {
      return !sameScale(this.naturalScale, this.fitScale);
    },
    /**
     * The zoomed viewport's height. Absent (null) at the fit level, so the
     * untouched diagram carries no inline height and the Forge iframe keeps
     * sizing itself from the diagram exactly as before.
     */
    viewportStyle() {
      if (!this.isZoomed) return null;
      const fitHeight = this.baseSize.height;
      if (!(fitHeight > 0)) return null;
      const height = Math.min(this.scaledSize.height, Math.max(fitHeight, MIN_ZOOMED_VIEWPORT_PX));
      // Growing is the point; shrinking below the diagram's own box is not.
      if (height <= fitHeight) return null;
      return { height: `${Math.round(height)}px` };
    },
    canvasStyle() {
      // No style object at all at the fit level: the untouched diagram keeps
      // the exact DOM it had before zoom existed.
      if (!this.isZoomed) return null;
      return {
        transform: `translate(${this.pan.x}px, ${this.pan.y}px) scale(${this.transformScale})`,
        transformOrigin: '0 0',
        willChange: 'transform',
      };
    },
    scaledSize() {
      const k = this.transformScale;
      return { width: this.baseSize.width * k, height: this.baseSize.height * k };
    },
    canPan() {
      if (!this.isZoomed) return false;
      return this.scaledSize.width > this.viewportSize.width + 1
        || this.scaledSize.height > this.viewportSize.height + 1;
    },
    canZoomIn() {
      return !sameScale(stepScale(this.naturalScale, 1, this.fitScale), this.naturalScale);
    },
    canZoomOut() {
      return !sameScale(stepScale(this.naturalScale, -1, this.fitScale), this.naturalScale);
    },
    zoomLabel() {
      return formatZoomLabel(this.naturalScale);
    },
  },
  async mounted() {
    if (!this.mermaidCode) return;
    // Phase 0b: render_ms = loadMermaid + mermaid.render — exactly what an SVG
    // cache (Lever D) would skip. Only the initial mount render is timed
    // (renderPerf records once); the watch-driven re-render below is not.
    this.svg = await renderPerf.time('render', () => this.render(this.mermaidCode));
    trackRenderTime('mermaid', this.isDisplayMode);
    // Type may have switched during the async render — the gated computed
    // would then be `false` and the store diagramType stale. Skip; the new
    // type's component emits its own diagramLoaded.
    if (this.mermaidCode) {
      EventBus.$emit('diagramLoaded', this.mermaidCode, DiagramType.Mermaid);
    }
    await globals.apWrapper.initializeContext();
  },
  created() {
    // Non-reactive by design: gesture bookkeeping that no template reads, and
    // that must not schedule a re-render on every pointermove.
    this.zoomObserver = null;
    this.drag = null;
    this.zoomEventTimer = null;
    this.panEventTimer = null;
    this.pendingZoomAction = null;
    this.pendingPan = false;
    if (!this.zoomEnabled) return;
    // A capture rasterises `.screen-capture-content`, which contains this
    // component: a zoomed diagram would export as the cropped fragment the
    // reader happened to be looking at. Reset to fit for the duration.
    // (The silent view-time snapshot backup in SnapshotAttachment.ts runs at
    // load, before any reader can have zoomed, so it needs no signal.)
    EventBus.$on('diagramCaptureStart', this.onCaptureStart);
    EventBus.$on('diagramCaptureEnd', this.onCaptureEnd);
  },
  beforeUnmount() {
    this.zoomObserver?.disconnect();
    this.zoomObserver = null;
    // Flush rather than drop: a reader who zooms and immediately navigates
    // away is exactly the session worth counting.
    this.flushZoomEvent();
    this.flushPanEvent();
    EventBus.$off('diagramCaptureStart', this.onCaptureStart);
    EventBus.$off('diagramCaptureEnd', this.onCaptureEnd);
  },
  updated() {
    // Don't use updated() to render, because it will cause infinite loop.
  },
  watch: {
    async mermaidCode(newVal) {
      // New content is a different picture, so the level the reader chose for
      // the old one means nothing for it — drop back to fit. Deliberately NOT
      // done in the `svg` watcher below: a re-render of the SAME code (the
      // post-layout retry, a store round-trip) would otherwise yank a reader
      // who had zoomed in back out from under them.
      this.resetZoom(null);
      if (!newVal) {
        this.svg = null;
      } else {
        this.svg = await this.render(this.mermaidCode);
      }
    },
    // A fresh SVG means fresh measurements; the level survives.
    svg() {
      if (!this.zoomEnabled) return;
      this.$nextTick(() => {
        this.measureZoom({ keepLevel: true });
        this.observeViewport();
      });
    },
  },
  methods: {
    async runMermaid(code) {
      // Generate a unique ID to avoid conflicts
      this.renderId = `mermaid-${crypto.randomUUID()}`;
      const mermaid = await loadMermaid();
      // Bodies stored before the save-time normalisation still carry pasted
      // U+00A0, which mermaid's Langium grammars refuse. Normalising here is
      // what makes those diagrams render again without a data migration.
      const source = normalizeMermaidWhitespace(code);
      // Use the unique ID to render, avoiding creating extra elements in the body
      const { svg } = await mermaid.render(this.renderId, source);
      // A `useMaxWidth: false` diagram carries a fixed height that our flex
      // wrapper cannot shrink, which letterboxes the drawing. See
      // normalizeSvgSizing for the measurement.
      return normalizeSvgSizing(svg);
    },
    removeTempNode() {
      if (!this.renderId) return;
      document.getElementById(`d${this.renderId}`)?.remove();
    },
    reportCrash(error) {
      console.error('mermaid render error', error);
      // reliability-audit-2026-08-06 §3/§12.1: a mermaid.js exception used to
      // be console.error-only — the blank result still got recorded as a
      // successful macro_viewed by mounted()'s unconditional trackRenderTime.
      // This adds the missing failure signal without changing that existing
      // (silent-degrade) UX.
      trackViewerRenderCrash('mermaid', this.isDisplayMode, error);
      this.removeTempNode();
    },
    async render(code) {
      try {
        return await this.runMermaid(code);
      } catch (error) {
        this.removeTempNode();
        // mermaid measures a temp node with getBBox. In a document with no
        // layout box that measurement throws `svg element not in render tree`
        // and the same input renders cleanly once the box exists (reproduced
        // against mermaid 11.12.2 in Chrome — see renderGate/documentLayout).
        // Retry rather than leave the reader with a permanently blank diagram.
        if (!hasLayout()) {
          // Off the awaited path on purpose: the wait can last until a hidden
          // iframe is shown, and folding that into the caller would report it
          // as render_ms. The retry assigns this.svg when it lands.
          this.retryAfterLayout(code);
          return;
        }
        // With a layout box present the failure is deterministic (bad syntax,
        // an unsupported diagram type); a retry would only repeat it.
        this.reportCrash(error);
      }
    },
    async retryAfterLayout(code) {
      await awaitLayout();
      try {
        const svg = await this.runMermaid(code);
        // The diagram may have been edited or switched away during the wait.
        if (this.mermaidCode === code) {
          this.svg = svg;
        }
      } catch (error) {
        this.reportCrash(error);
      }
    },

    // ---- zoom: measurement -------------------------------------------------

    /**
     * Re-derive the fit scale and the box sizes from the DOM.
     *
     * `keepLevel` distinguishes the two callers. A re-render starts the reader
     * at the new diagram's fit level; a container resize (the Confluence page
     * reflowing, the Fullscreen modal opening) must NOT throw away the level
     * the reader chose — the diagram redraws at a different fit scale and the
     * same naturalScale simply needs a different transform.
     */
    measureZoom({ keepLevel } = { keepLevel: true }) {
      const viewport = this.$refs.viewport;
      const canvas = this.$refs.canvas;
      if (!viewport || !canvas) return;
      const svg = canvas.querySelector('svg');

      this.viewportSize = { width: viewport.clientWidth, height: viewport.clientHeight };
      this.baseSize = { width: canvas.offsetWidth, height: canvas.offsetHeight };

      const fit = this.measureFitScale(svg);
      const wasAtFit = !keepLevel || sameScale(this.naturalScale, this.fitScale);
      this.fitScale = fit;
      if (wasAtFit) {
        this.naturalScale = fit;
        this.pan = { x: 0, y: 0 };
      } else {
        this.naturalScale = clampScale(this.naturalScale, fit);
        this.clampCurrentPan();
      }
    },

    /**
     * Rendered width over natural width.
     *
     * The rendered width is divided by the transform currently applied,
     * because getBoundingClientRect() reports the TRANSFORMED box — measuring
     * a zoomed diagram without that division would feed the zoom back into the
     * fit scale and the two would chase each other. Anything unmeasurable
     * (a detached node, jsdom, a hidden macro iframe) degrades to 1, i.e. "the
     * diagram is at its natural size", which is the safe reading: it makes the
     * control a no-op rather than magnifying a diagram on load.
     */
    measureFitScale(svg) {
      if (!svg) return 1;
      const natural = this.naturalWidthOf(svg);
      const rendered = svg.getBoundingClientRect().width / (this.transformScale || 1);
      if (!(natural > 0) || !(rendered > 0)) return 1;
      return rendered / natural;
    },

    /**
     * The width mermaid drew the diagram at, before any container shrank it.
     * normalizeSvgSizing puts it in `max-width` for every diagram it rewrites;
     * the viewBox and the width attribute cover the shapes it passes through
     * untouched.
     */
    naturalWidthOf(svg) {
      const maxWidth = parseFloat(svg.style?.maxWidth ?? '');
      if (Number.isFinite(maxWidth) && maxWidth > 0) return maxWidth;
      const viewBox = svg.viewBox?.baseVal?.width;
      if (Number.isFinite(viewBox) && viewBox > 0) return viewBox;
      const attr = parseFloat(svg.getAttribute?.('width') ?? '');
      return Number.isFinite(attr) && attr > 0 ? attr : 0;
    },

    observeViewport() {
      if (this.zoomObserver || typeof ResizeObserver === 'undefined') return;
      const viewport = this.$refs.viewport;
      if (!viewport) return;
      this.zoomObserver = new ResizeObserver(() => this.measureZoom({ keepLevel: true }));
      this.zoomObserver.observe(viewport);
    },

    clampCurrentPan() {
      this.pan = clampPan(this.pan, this.viewportSize, this.scaledSize);
    },

    viewportCentre() {
      return { x: this.viewportSize.width / 2, y: this.viewportSize.height / 2 };
    },

    // ---- zoom: actions -----------------------------------------------------

    /**
     * Move to `next`, holding `anchor` (viewport coordinates) still. Returns
     * false — and reports nothing — when the level does not actually change,
     * so a click at the end of the ladder is not counted as a zoom.
     */
    applyZoom(next, anchor, action, input) {
      const target = clampScale(next, this.fitScale);
      if (sameScale(target, this.naturalScale)) return false;
      const from = this.transformScale;
      this.naturalScale = target;
      this.pan = panAfterZoom(this.pan, anchor || this.viewportCentre(), from, this.transformScale);
      this.clampCurrentPan();
      this.trackZoom(action, input);
      return true;
    },

    zoomIn(input) {
      this.applyZoom(stepScale(this.naturalScale, 1, this.fitScale), null, 'in', input);
    },

    zoomOut(input) {
      this.applyZoom(stepScale(this.naturalScale, -1, this.fitScale), null, 'out', input);
    },

    resetZoom(input) {
      if (!this.isZoomed) return;
      this.naturalScale = this.fitScale;
      this.pan = { x: 0, y: 0 };
      if (input) this.trackZoom('reset', input);
    },

    panBy(dx, dy) {
      this.pan = clampPan(
        { x: this.pan.x + dx, y: this.pan.y + dy },
        this.viewportSize,
        this.scaledSize,
      );
      this.trackPan();
    },

    // ---- zoom: input -------------------------------------------------------

    /**
     * ctrl/cmd+wheel only, on BOTH surfaces.
     *
     * An unmodified wheel has to keep scrolling the page: inline, the macro
     * sits in a scrolling Confluence page, and in Fullscreen a tall diagram
     * scrolls the modal — swallowing the wheel on either would trap the
     * reader. The modifier is also what a trackpad pinch sends (a wheel event
     * with ctrlKey set), so pinch-to-zoom works through this same path.
     */
    onWheel(event) {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      // Exponential so a fast flick covers ground and a slow one is precise;
      // 0.002 puts a typical 100px notch at about one ladder step.
      const factor = Math.exp(-event.deltaY * 0.002);
      this.applyZoom(
        this.naturalScale * factor,
        this.pointInViewport(event),
        event.deltaY < 0 ? 'in' : 'out',
        'wheel',
      );
    },

    pointInViewport(event) {
      const rect = this.$refs.viewport?.getBoundingClientRect();
      if (!rect) return this.viewportCentre();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    },

    onPointerDown(event) {
      if (!this.canPan || event.button !== 0) return;
      this.drag = { x: event.clientX, y: event.clientY, pan: { ...this.pan }, moved: false };
      this.isDragging = true;
      // Capture so a drag that leaves the diagram (easy, it is clipped) keeps
      // panning instead of sticking mid-gesture.
      event.currentTarget.setPointerCapture?.(event.pointerId);
      // Suppress the browser's native image/text drag.
      event.preventDefault();
    },

    onPointerMove(event) {
      if (!this.isDragging) return;
      const dx = event.clientX - this.drag.x;
      const dy = event.clientY - this.drag.y;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) this.drag.moved = true;
      this.pan = clampPan(
        { x: this.drag.pan.x + dx, y: this.drag.pan.y + dy },
        this.viewportSize,
        this.scaledSize,
      );
    },

    onPointerUp(event) {
      if (!this.isDragging) return;
      this.isDragging = false;
      if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      // A click that never moved is a click, not a pan.
      if (this.drag?.moved) this.trackPan();
    },

    onKeydown(event) {
      if (event.altKey || event.ctrlKey || event.metaKey) return;
      const STEP_PX = 40;
      switch (event.key) {
        case '+':
        case '=':
          this.zoomIn('keyboard');
          break;
        case '-':
        case '_':
          this.zoomOut('keyboard');
          break;
        case '0':
          this.resetZoom('keyboard');
          break;
        case 'ArrowLeft':
        case 'ArrowRight':
        case 'ArrowUp':
        case 'ArrowDown': {
          // Only claim the arrow keys when there is somewhere to pan;
          // otherwise they stay the page's, as they are today.
          if (!this.canPan) return;
          const dx = (event.key === 'ArrowLeft' ? 1 : event.key === 'ArrowRight' ? -1 : 0) * STEP_PX;
          const dy = (event.key === 'ArrowUp' ? 1 : event.key === 'ArrowDown' ? -1 : 0) * STEP_PX;
          this.panBy(dx, dy);
          break;
        }
        default:
          return;
      }
      event.preventDefault();
    },

    onCaptureStart() {
      this.resetZoom(null);
      this.capturing = true;
    },

    onCaptureEnd() {
      this.capturing = false;
    },

    // ---- zoom: analytics ---------------------------------------------------

    zoomProperties() {
      return {
        feature_area: 'macro',
        surface: this.surface,
        macro_type: 'mermaid',
        zoom_level: roundScale(this.naturalScale),
        zoom_fit_scale: roundScale(this.fitScale),
      };
    },

    /**
     * A button or a key is one deliberate action and is reported immediately.
     * A wheel gesture is dozens of events for one intent, so it is coalesced
     * into a single event carrying the level the gesture ended on.
     */
    trackZoom(action, input) {
      if (input !== 'wheel') {
        trackAnalyticsEvent('viewer_zoom_changed', {
          ...this.zoomProperties(),
          zoom_action: action,
          zoom_input: input,
        });
        return;
      }
      this.pendingZoomAction = action;
      clearTimeout(this.zoomEventTimer);
      this.zoomEventTimer = setTimeout(this.flushZoomEvent, GESTURE_IDLE_MS);
    },

    flushZoomEvent() {
      clearTimeout(this.zoomEventTimer);
      this.zoomEventTimer = null;
      if (!this.pendingZoomAction) return;
      const zoom_action = this.pendingZoomAction;
      this.pendingZoomAction = null;
      trackAnalyticsEvent('viewer_zoom_changed', {
        ...this.zoomProperties(),
        zoom_action,
        zoom_input: 'wheel',
      });
    },

    /** One event per gesture, not per pointermove or per arrow-key repeat. */
    trackPan() {
      this.pendingPan = true;
      clearTimeout(this.panEventTimer);
      this.panEventTimer = setTimeout(this.flushPanEvent, GESTURE_IDLE_MS);
    },

    flushPanEvent() {
      clearTimeout(this.panEventTimer);
      this.panEventTimer = null;
      if (!this.pendingPan) return;
      this.pendingPan = false;
      trackAnalyticsEvent('viewer_diagram_panned', this.zoomProperties());
    },
  }
}
</script>

<style scoped>
.mermaid-zoom {
  position: relative;
}

/* Only a zoomed diagram clips. At the fit level this is a plain block, so an
   untouched diagram keeps the overflow behaviour (and the intrinsic height the
   Forge iframe sizes itself from) that it has always had. */
.mermaid-zoom-viewport {
  outline: none;
}

.mermaid-zoom-viewport--zoomed {
  overflow: hidden;
  /* Stop the browser from panning the PAGE when a touch drag starts on a
     diagram the reader is panning. */
  touch-action: none;
}

.mermaid-zoom-viewport--grabbable {
  cursor: grab;
}

.mermaid-zoom-viewport--grabbing {
  cursor: grabbing;
  user-select: none;
}

.mermaid-zoom-viewport:focus-visible {
  outline: 2px solid #4c9aff;
  outline-offset: 2px;
  border-radius: 3px;
}

.mermaid-zoom-controls {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid rgba(9, 30, 66, 0.14);
  box-shadow: 0 1px 3px rgba(9, 30, 66, 0.16);
  opacity: 0;
  transition: opacity 120ms ease-in-out;
  /* Invisible chrome must not eat clicks meant for the diagram. */
  pointer-events: none;
}

.mermaid-zoom:hover .mermaid-zoom-controls,
.mermaid-zoom:focus-within .mermaid-zoom-controls,
.mermaid-zoom-controls--pinned {
  opacity: 1;
  pointer-events: auto;
}

.mermaid-zoom-btn,
.mermaid-zoom-level {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #44546f;
  cursor: pointer;
  font-size: 11px;
  line-height: 1;
}

.mermaid-zoom-btn {
  width: 22px;
  padding: 0;
}

.mermaid-zoom-btn svg {
  width: 13px;
  height: 13px;
}

.mermaid-zoom-level {
  min-width: 42px;
  padding: 0 4px;
  font-variant-numeric: tabular-nums;
}

.mermaid-zoom-btn:hover:not(:disabled),
.mermaid-zoom-level:hover:not(:disabled) {
  background: rgba(9, 30, 66, 0.06);
  color: #172b4d;
}

.mermaid-zoom-btn:disabled,
.mermaid-zoom-level:disabled {
  color: #8993a4;
  cursor: default;
}
</style>
