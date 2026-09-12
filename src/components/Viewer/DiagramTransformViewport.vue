<template>
  <div
    ref="viewport"
    class="transform-viewport"
    :class="{
      'transform-viewport--interactive': isInteractive,
      'transform-viewport--filled': !sizeToContent,
    }"
  >
    <div ref="content" class="transform-viewport-content">
      <slot></slot>
    </div>
    <DiagramViewportToolbar
      v-if="isInteractive"
      :macro-type="macroType"
      :label="label"
      @zoom-in="zoomIn"
      @zoom-out="zoomOut"
    />
    <ViewportZoomHint v-if="isInteractive" ref="zoomHint" :macro-type="macroType" />
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
import { createWheelStepper, createZoomHintTrigger, isZoomIntent } from '@/utils/viewport/wheelZoom';
import { wheelFallsThroughToPage } from '@/utils/viewport/surface';
import ViewportZoomHint from '@/components/Viewer/ViewportZoomHint.vue';

/** Matches svg-pan-zoom's limits on the other viewports. */
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 12;
const ZOOM_STEP = 1.2;
/** Below this a press is a click on the diagram, not a pan. */
const DRAG_TOLERANCE_PX = 4;

export default {
  name: 'DiagramTransformViewport',
  components: { DiagramViewportToolbar, ViewportZoomHint },
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
      this.applyTransform();
    },
    applyTransform() {
      if (!this.target) return;
      this.target.style.transformOrigin = 'top left';
      this.target.style.transform =
        `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    },
    zoomBy(factor) {
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.userZoom * factor));
      if (next === this.userZoom) return;
      // Keep the box centre fixed rather than the top-left corner, or zooming in
      // walks the diagram off the bottom-right of the frame.
      const viewport = this.$refs.viewport;
      const centreX = (viewport?.clientWidth ?? 0) / 2;
      const centreY = (viewport?.clientHeight ?? 0) / 2;
      const ratio = next / this.userZoom;
      this.panX = centreX - (centreX - this.panX) * ratio;
      this.panY = centreY - (centreY - this.panY) * ratio;
      this.userZoom = next;
      this.applyTransform();
    },
    zoomIn() {
      this.zoomBy(ZOOM_STEP);
    },
    zoomOut() {
      this.zoomBy(1 / ZOOM_STEP);
    },
    bindGestures() {
      const viewport = this.$refs.viewport;
      if (!viewport || this.wheelHandler) return;
      const step = createWheelStepper((direction) => {
        this.zoomBy(direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
      });
      const hint = createZoomHintTrigger(() => this.$refs.zoomHint?.show());
      this.wheelHandler = (event) => {
        // A plain wheel stays the page's to scroll; only Ctrl/Cmd (or a trackpad
        // pinch, which arrives as one) means zoom. See isZoomIntent.
        if (!isZoomIntent(event)) {
          // ...unless this surface has no page to give it to, in which case the
          // wheel did nothing and the reader deserves to be told why.
          if (!wheelFallsThroughToPage(this.$store.getters.isDisplayMode)) {
            hint(event, viewport.clientHeight);
          }
          return;
        }
        event.preventDefault();
        step(event, viewport.clientHeight);
      };
      // Not passive: a zoom has to take the event away from page scroll. Only
      // the zoom branch above does, so an ungated wheel still reaches the page.
      viewport.addEventListener('wheel', this.wheelHandler, { passive: false });
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
      }
      this.panX = this.dragStart.panX + dx;
      this.panY = this.dragStart.panY + dy;
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
</style>
