<template>
  <div
    ref="viewport"
    class="transform-viewport"
    :class="{
      'transform-viewport--interactive': isInteractive,
      'transform-viewport--filled': !sizeToContent,
      'transform-viewport--dragging': dragging,
    }"
  >
    <div ref="content" class="transform-viewport-content">
      <slot></slot>
    </div>
    <DiagramViewportToolbar
      v-if="isInteractive"
      :macro-type="macroType"
      :label="label"
      :ready="!!target"
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
 * Pan/zoom viewport for renderers that produce HTML rather than one inline
 * `<svg>` — today that is Sequence (ZenUML). It scales through a CSS transform
 * on the rendered element instead of svg-pan-zoom, which needs an SVG root.
 *
 * It replaces ViewResizer, whose fit-to-width it keeps exactly: measure the
 * rendered content, scale it down to the box, never up. On top of that it adds
 * the user zoom, drag-to-pan and the shared toolbar that Mermaid, PlantUML and
 * Graph already have.
 *
 * The content is interactive — a ZenUML participant name is editable and the
 * footer carries the theme control — so panning starts only past a drag
 * tolerance and never swallows a plain click.
 */
import DiagramViewportToolbar from '@/components/Viewer/DiagramViewportToolbar.vue';
import {
  alignOf, axisOffset, bindSafariPinch, clampScale, classifyWheel, createGestureGate, zoomLimits, zoomRoom,
} from '@/utils/viewport/wheelZoom';
import { trackViewportControl } from '@/utils/viewport/trackViewportControl';
import { TOOLBAR_ZOOM_STEP } from '@/utils/viewport/zoomStep';
import { wheelFallsThroughToPage } from '@/utils/viewport/surface';

/** Below this a press is a click on the diagram, not a pan. */
const DRAG_TOLERANCE_PX = 4;

export default {
  name: 'DiagramTransformViewport',
  components: { DiagramViewportToolbar },
  props: {
    /** Analytics `macro_type` — the renderer this viewport is driving. */
    macroType: {
      type: String,
      required: true,
    },
    /** Human name used in the toolbar's accessible label. */
    label: {
      type: String,
      required: true,
    },
    /**
     * CSS selector for the element to transform, resolved inside the slot. The
     * renderer owns this DOM, so the viewport cannot assume its shape.
     */
    contentSelector: {
      type: String,
      required: true,
    },
    /**
     * True on the page viewer, where the box has no height of its own to inherit
     * (the Forge macro iframe is sized by its content) and must be set to the
     * scaled content height. False in fullscreen and the editor, where the pane
     * already has a height and the viewport fills it.
     */
    sizeToContent: {
      type: Boolean,
      default: false,
    },
  },
  data() {
    return {
      target: null,
      naturalWidth: 0,
      naturalHeight: 0,
      fitScale: 1,
      userZoom: 1,
      panX: 0,
      panY: 0,
      resizeObserver: null,
      wheelHandler: null,
      unbindPinch: null,
      // Where a diagram smaller than the box sits in it (0 start .. 1 end), read
      // at opening so the pan limit holds it there rather than recentring it.
      alignX: 0,
      alignY: 0,
      pointerId: null,
      dragging: false,
      dragStart: null,
    };
  },
  computed: {
    // Same rule as DiagramViewport: the Export PNG host renders the diagram only
    // to photograph it, and a transform (or a toolbar) would land in the capture.
    isInteractive() {
      return window.forgeGlobal?.forgeContext?.extension?.modal?.openExport !== true;
    },
    scale() {
      return this.fitScale * this.userZoom;
    },
    /** userZoom range: opening size up to natural size (see zoomLimits). */
    userZoomLimits() {
      const { min, max } = zoomLimits(this.fitScale);
      return { min: min / this.fitScale, max: max / this.fitScale };
    },
    room() {
      return zoomRoom(this.userZoom, this.userZoomLimits);
    },
  },
  mounted() {
    if (!this.isInteractive) return;
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.layout());
      this.resizeObserver.observe(this.$refs.viewport);
    }
    this.bindGestures();
  },
  beforeUnmount() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.unbindGestures();
  },
  methods: {
    /**
     * Re-measure and re-fit. The parent calls this after every render: the
     * rendered DOM is replaced wholesale, so the previous target is stale.
     */
    async layout() {
      await this.$nextTick();
      if (!this.isInteractive) return;
      const viewport = this.$refs.viewport;
      const target = this.$refs.content?.querySelector(this.contentSelector);
      if (!viewport || !target) return;
      // Transforms do not affect layout metrics, so this stays the untransformed
      // size however zoomed the diagram currently is.
      const width = target.scrollWidth;
      const height = target.scrollHeight;
      if (!width || !height) return;

      const reset = width !== this.naturalWidth || height !== this.naturalHeight;
      this.target = target;
      this.naturalWidth = width;
      this.naturalHeight = height;

      const boxWidth = viewport.clientWidth;
      // Never magnify: the same 1:1 ceiling the SVG viewports apply. ViewResizer
      // capped at 1 too, so the page viewer is unchanged at rest.
      const byWidth = boxWidth > 0 ? boxWidth / width : 1;
      const boxHeight = this.sizeToContent ? 0 : viewport.clientHeight;
      const byHeight = boxHeight > 0 ? boxHeight / height : Infinity;
      this.fitScale = Math.max(0.1, Math.min(1, byWidth, byHeight));

      // A new diagram starts fitted rather than inheriting the last one's zoom.
      if (reset) {
        this.userZoom = 1;
        this.panX = 0;
        this.panY = 0;
      }
      if (this.sizeToContent) {
        viewport.style.height = `${height * this.fitScale}px`;
      }
      this.userZoom = clampScale(this.userZoom, this.userZoomLimits);
      if (reset) this.captureAlign();
      this.applyTransform();
    },
    /** Remember where the diagram sits in the box, for the pan limit. */
    captureAlign() {
      const viewport = this.$refs.viewport;
      if (!viewport) return;
      this.alignX = alignOf(this.panX, this.naturalWidth * this.scale, viewport.clientWidth);
      this.alignY = alignOf(this.panY, this.naturalHeight * this.scale, viewport.clientHeight);
    },
    /**
     * Keep the diagram in view: an edge never comes inside the box edge, and a
     * diagram smaller than the box stays where it opened. Applied on user input
     * only, so the opening position is exactly what it was before the limit.
     */
    limitPan() {
      const viewport = this.$refs.viewport;
      if (!viewport || !this.naturalWidth) return;
      this.panX = axisOffset(this.panX, this.naturalWidth * this.scale, viewport.clientWidth, this.alignX);
      this.panY = axisOffset(this.panY, this.naturalHeight * this.scale, viewport.clientHeight, this.alignY);
    },
    applyTransform() {
      if (!this.target) return;
      this.target.style.transformOrigin = 'top left';
      this.target.style.transform =
        `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    },
    /** Toolbar zoom: about the box centre. */
    zoomBy(factor) {
      const viewport = this.$refs.viewport;
      this.zoomAt(factor, (viewport?.clientWidth ?? 0) / 2, (viewport?.clientHeight ?? 0) / 2);
    },
    /**
     * Zoom keeping the content point at (x, y) — box pixels — where it is, so
     * the part of the diagram under the pointer stays under it.
     */
    zoomAt(factor, x, y) {
      const next = clampScale(this.userZoom * factor, this.userZoomLimits);
      if (next === this.userZoom) return;
      const ratio = next / this.userZoom;
      this.panX = x - (x - this.panX) * ratio;
      this.panY = y - (y - this.panY) * ratio;
      this.userZoom = next;
      this.limitPan();
      this.applyTransform();
    },
    /** Pointer position in box pixels. */
    boxPoint(clientX, clientY) {
      const rect = this.$refs.viewport.getBoundingClientRect();
      return { x: clientX - rect.left, y: clientY - rect.top };
    },
    zoomIn() {
      this.zoomBy(TOOLBAR_ZOOM_STEP);
    },
    zoomOut() {
      this.zoomBy(1 / TOOLBAR_ZOOM_STEP);
    },
    fitAxis(axis) {
      const viewport = this.$refs.viewport;
      if (!viewport || !this.target || !this.naturalWidth || !this.naturalHeight) return;
      const extent = axis === 'width' ? this.naturalWidth : this.naturalHeight;
      const available = axis === 'width' ? viewport.clientWidth : viewport.clientHeight;
      if (!(available > 0)) return;
      this.userZoom = clampScale(available / extent / this.fitScale, this.userZoomLimits);
      this.panX = (viewport.clientWidth - this.naturalWidth * this.scale) / 2;
      this.panY = (viewport.clientHeight - this.naturalHeight * this.scale) / 2;
      // A fit is a deliberate re-layout: the centred position is the new rest.
      this.captureAlign();
      this.limitPan();
      this.applyTransform();
    },
    bindGestures() {
      const viewport = this.$refs.viewport;
      if (!viewport || this.wheelHandler) return;
      const startsGesture = createGestureGate();
      this.wheelHandler = (event) => {
        if (!this.target) return;
        const action = classifyWheel(event, {
          plainWheelZooms: !wheelFallsThroughToPage(this.$store.getters.isDisplayMode),
          pageHeight: viewport.clientHeight,
          pageWidth: viewport.clientWidth,
        });
        // A plain wheel on the page viewer is the page's to scroll.
        if (action.kind === 'pass') return;
        event.preventDefault();
        if (action.kind === 'pan') {
          this.panX += action.dx;
          this.panY += action.dy;
          this.limitPan();
          this.applyTransform();
          return;
        }
        const point = this.boxPoint(event.clientX, event.clientY);
        this.zoomAt(action.factor, point.x, point.y);
        // One event per gesture, not per wheel event: the gate stays shut for
        // the rest of a continuous scroll, so a wheel zoom costs the same one
        // event as a button click and the two can be compared.
        if (!startsGesture()) return;
        trackViewportControl({
          macroType: this.macroType,
          viewportAction: action.factor > 1 ? 'zoom_in' : 'zoom_out',
          viewportInput: 'wheel',
          wheelModifier: action.modifier,
          isDisplayMode: this.$store.getters.isDisplayMode,
        });
      };
      // Not passive: a zoom has to take the event away from page scroll. Only
      // the zoom and pan branches do, so a page-viewer plain wheel still scrolls.
      viewport.addEventListener('wheel', this.wheelHandler, { passive: false });
      this.unbindPinch = bindSafariPinch(viewport, (factor, clientX, clientY) => {
        const point = this.boxPoint(clientX, clientY);
        this.zoomAt(factor, point.x, point.y);
      });
      viewport.addEventListener('pointerdown', this.onPointerDown);
      viewport.addEventListener('pointermove', this.onPointerMove);
      viewport.addEventListener('pointerup', this.onPointerUp);
      viewport.addEventListener('pointercancel', this.onPointerUp);
    },
    unbindGestures() {
      const viewport = this.$refs.viewport;
      if (!viewport) return;
      if (this.wheelHandler) viewport.removeEventListener('wheel', this.wheelHandler);
      this.wheelHandler = null;
      this.unbindPinch?.();
      this.unbindPinch = null;
      viewport.removeEventListener('pointerdown', this.onPointerDown);
      viewport.removeEventListener('pointermove', this.onPointerMove);
      viewport.removeEventListener('pointerup', this.onPointerUp);
      viewport.removeEventListener('pointercancel', this.onPointerUp);
    },
    onPointerDown(event) {
      if (event.button !== 0) return;
      // No preventDefault and no capture yet: until the pointer moves past the
      // tolerance this is still a click on whatever ZenUML rendered underneath.
      this.pointerId = event.pointerId;
      this.dragStart = { x: event.clientX, y: event.clientY, panX: this.panX, panY: this.panY };
      this.dragging = false;
    },
    onPointerMove(event) {
      if (this.dragStart === null || event.pointerId !== this.pointerId) return;
      const dx = event.clientX - this.dragStart.x;
      const dy = event.clientY - this.dragStart.y;
      if (!this.dragging) {
        if (Math.abs(dx) < DRAG_TOLERANCE_PX && Math.abs(dy) < DRAG_TOLERANCE_PX) return;
        this.dragging = true;
        this.$refs.viewport?.setPointerCapture?.(event.pointerId);
        // Past the tolerance this is a pan, not a text selection. Clear what the
        // press already started selecting; the dragging class stops the rest.
        // Only here, not on pointerdown: a click must still reach the editable
        // participant names, and double-click must still select a word.
        window.getSelection?.()?.removeAllRanges();
      }
      this.panX = this.dragStart.panX + dx;
      this.panY = this.dragStart.panY + dy;
      this.limitPan();
      this.applyTransform();
    },
    onPointerUp(event) {
      if (event.pointerId !== this.pointerId) return;
      if (this.dragging) this.$refs.viewport?.releasePointerCapture?.(event.pointerId);
      this.pointerId = null;
      this.dragStart = null;
      this.dragging = false;
    },
  },
};
</script>

<style scoped>
.transform-viewport {
  position: relative;
  width: 100%;
  margin: 0 auto;
}

.transform-viewport--interactive {
  overflow: hidden;
}

.transform-viewport--filled {
  height: 100%;
}

.transform-viewport--interactive .transform-viewport-content {
  cursor: grab;
}

/* The renderer owns this subtree, so the hint has to reach into it. */
.transform-viewport--interactive .transform-viewport-content :deep(> * > *) {
  will-change: transform;
}

.transform-viewport--interactive .transform-viewport-content:active {
  cursor: grabbing;
}

.transform-viewport--dragging,
.transform-viewport--dragging :deep(*) {
  user-select: none;
  -webkit-user-select: none;
}
</style>
