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
    <div
      v-else
      ref="viewport"
      class="mermaid-viewport"
      :class="{
        'mermaid-viewport--interactive': isInteractiveViewport,
        'mermaid-viewport--fullscreen': isFullscreenMode,
      }"
    >
      <div ref="diagram" class="mermaid-diagram flex justify-center" v-html="svg"></div>
      <div
        v-if="isInteractiveViewport"
        class="mermaid-viewport-toolbar"
        role="toolbar"
        aria-label="Mermaid zoom controls"
      >
        <button type="button" class="mermaid-viewport-button" aria-label="Zoom out" title="Zoom out" @click="zoomOut">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M15.2 15.2 21 21"/></svg>
        </button>
        <button type="button" class="mermaid-viewport-button" aria-label="Zoom in" title="Zoom in" @click="zoomIn">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M7.5 10.5h6M10.5 7.5v6M15.2 15.2 21 21"/></svg>
        </button>
      </div>
    </div>
  </div>
</template>

<script>
import { loadMermaid } from '@/utils/mermaid/loadMermaid'
import { normalizeSvgSizing } from '@/utils/mermaid/normalizeSvgSizing'
import { normalizeMermaidWhitespace } from '@/utils/mermaid/normalizeWhitespace'
import EventBus from "@/EventBus";
import {DiagramType} from "@/model/Diagram/Diagram";
import globals from '@/model/globals';
import { trackRenderTime } from '@/utils/analytics/trackRenderTime';
import { trackViewerRenderCrash } from '@/utils/analytics/trackViewerRenderCrash';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { hasLayout, awaitLayout } from '@/utils/renderGate/documentLayout';
import * as renderPerf from '@/utils/analytics/renderPerf';
import svgPanZoom from 'svg-pan-zoom';
import Hammer from 'hammerjs';

export default {
  name: "Mermaid",
  data() {
    return {
      svg: null,
      renderId: null,
      panZoom: null,
      panZoomSvg: null,
      panZoomDirty: false,
      panZoomResizeObserver: null,
    }
  },
  computed: {
    mermaidCode() {
      return this.$store.state.diagram.diagramType === DiagramType.Mermaid && this.$store.state.diagram.mermaidCode;
    },
    isDisplayMode() {
      return this.$store.getters.isDisplayMode;
    },
    isFullscreenMode() {
      return window.forgeGlobal?.forgeContext?.extension?.modal?.macroMode === 'fullscreen';
    },
    isInteractiveViewport() {
      const modal = window.forgeGlobal?.forgeContext?.extension?.modal;
      return modal?.openExport !== true;
    },
    viewportSurface() {
      if (this.isFullscreenMode) return 'fullscreen';
      return this.isDisplayMode ? 'viewer' : 'editor';
    },
  },
  async mounted() {
    if (!this.mermaidCode) return;
    // Phase 0b: render_ms = loadMermaid + mermaid.render — exactly what an SVG
    // cache (Lever D) would skip. Only the initial mount render is timed
    // (renderPerf records once); the watch-driven re-render below is not.
    this.svg = await renderPerf.time('render', () => this.render(this.mermaidCode));
    await this.initializeViewport();
    trackRenderTime('mermaid', this.isDisplayMode);
    // Type may have switched during the async render — the gated computed
    // would then be `false` and the store diagramType stale. Skip; the new
    // type's component emits its own diagramLoaded.
    if (this.mermaidCode) {
      EventBus.$emit('diagramLoaded', this.mermaidCode, DiagramType.Mermaid);
    }
    await globals.apWrapper.initializeContext();
  },
  beforeUnmount() {
    this.destroyViewport();
  },
  watch: {
    async mermaidCode(newVal) {
      if (!newVal) {
        this.svg = null;
      } else {
        this.svg = await this.render(this.mermaidCode);
        await this.initializeViewport();
      }
    }
  },
  methods: {
    async initializeViewport() {
      await this.$nextTick();
      if (!this.isInteractiveViewport) {
        this.destroyViewport();
        return;
      }
      const svgElement = this.$refs.diagram?.querySelector('svg');
      if (!svgElement || svgElement === this.panZoomSvg) return;

      this.destroyViewport();
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
      this.resetViewport();

      if (typeof ResizeObserver !== 'undefined') {
        this.panZoomResizeObserver = new ResizeObserver(() => {
          this.panZoom?.resize();
          if (!this.panZoomDirty) this.resetViewport();
        });
        this.panZoomResizeObserver.observe(this.$refs.viewport);
      }
    },
    destroyViewport() {
      this.panZoomResizeObserver?.disconnect();
      this.panZoomResizeObserver = null;
      this.panZoom?.destroy();
      this.panZoom = null;
      this.panZoomSvg = null;
      this.panZoomDirty = false;
    },
    trackViewportAction(viewportAction) {
      trackAnalyticsEvent('mermaid_viewport_control_used', {
        feature_area: 'macro',
        surface: this.viewportSurface,
        macro_type: 'mermaid',
        viewport_action: viewportAction,
      });
    },
    resetViewport() {
      if (!this.panZoom) return;
      this.panZoom.reset();
      // Match Mermaid Live: leave breathing room for the floating toolbar.
      this.panZoom.zoom(0.875);
      this.panZoomDirty = false;
    },
    zoomIn() {
      this.panZoom?.zoomIn();
      this.trackViewportAction('zoom_in');
    },
    zoomOut() {
      this.panZoom?.zoomOut();
      this.trackViewportAction('zoom_out');
    },
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
          await this.initializeViewport();
        }
      } catch (error) {
        this.reportCrash(error);
      }
    }
  }
}
</script>

<style scoped>
.mermaid-viewport {
  position: relative;
  width: 100%;
}

.mermaid-viewport--fullscreen {
  height: max(280px, calc(100vh - 190px));
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.72);
}

.mermaid-viewport--interactive {
  overflow: hidden;
}

.mermaid-viewport--fullscreen .mermaid-diagram {
  width: 100%;
  height: 100%;
}

.mermaid-viewport--interactive .mermaid-diagram :deep(svg) {
  width: 100%;
  max-width: none !important;
  cursor: grab;
  touch-action: none;
}

.mermaid-viewport--fullscreen .mermaid-diagram :deep(svg) {
  height: 100%;
}

.mermaid-viewport--interactive .mermaid-diagram :deep(svg:active) {
  cursor: grabbing;
}

.mermaid-viewport-toolbar {
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

.mermaid-viewport-button {
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

.mermaid-viewport-button:hover {
  color: #172b4d;
  background: #f1f2f4;
}

.mermaid-viewport-button:focus-visible {
  outline: 2px solid #0c66e4;
  outline-offset: 1px;
}

.mermaid-viewport-button svg {
  width: 18px;
  height: 18px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

</style>
