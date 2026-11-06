<template>
  <Transition name="modal">
    <div v-if="visible" class="export-modal-backdrop" @click.self="$emit('close')">
      <div
        class="export-modal"
        ref="dialogEl"
        role="dialog"
        aria-modal="true"
        aria-label="Export image"
        tabindex="-1"
        @keydown="onDialogKeydown"
      >
        <ExportWorkspace
          :state="state"
          :waiting-for-preview="!captureReady"
          :surface="surface"
          :macro-type="macroType"
          @refresh="capturePreview"
          @close="$emit('close')"
          @export="handleExport"
          @copy="handleCopy"
        />
      </div>
      <FeedbackHost
        v-if="feedbackContext"
        :context="feedbackContext"
        :capture-current-view="captureExportWorkspace"
        :suppress-during-export="false"
      />
    </div>
  </Transition>
</template>

<script lang="ts">
import { defineComponent, watch, provide, onUnmounted, nextTick, ref, type PropType } from 'vue';
import ExportWorkspace from './ExportWorkspace.vue';
import { exportStateKey, useExportState } from './useExportState';
import { useExportEngine, type ExportContext, type ExportOptions } from './useExportEngine';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { MacroTypeValue, Surface } from '@/utils/analytics/catalog';
import { readExportSession, writeExportSession } from './exportSession';
import { isPlantUmlSource, fetchPlantUmlPngBlob } from '@/utils/plantuml/fetchPng';
import { cropCanvasToBox, measureCaptureCrop } from './captureCrop';
import { waitForCaptureAssets } from './captureReady';
import { captureBlob } from '@/model/captureBlob';
import FeedbackHost from '@/features/feedback/FeedbackHost.vue';
import { captureFeedbackElement } from '@/features/feedback/feedbackCapture';
import { deriveFeedbackContext } from '@/features/feedback/feedbackContext';
import type { FeedbackContext } from '@/features/feedback/feedbackSession';
import { getContext } from '@/model/globals/forgeGlobal';
import store from '@/model/store2';

const EXPORT_ERROR_MESSAGE =
  "Export failed — couldn't capture the diagram. Try Refresh, then export again.";
const COPIED_FEEDBACK_MS = 1500;

export default defineComponent({
  name: 'ExportModal',
  components: { ExportWorkspace, FeedbackHost },

  props: {
    visible: { type: Boolean, required: true },
    macroType: { type: String as PropType<MacroTypeValue>, default: 'none' },
    captureNodeGetter: { type: Function as PropType<() => HTMLElement | null> },
    diagramTitle: { type: String, default: '' },
    /**
     * Which macro surface the export was started from. Was the literal
     * `'modal'` on all four export events, which made an inline export and a
     * Fullscreen one indistinguishable; every other GenericViewer event already
     * reports `viewer` / `fullscreen`, so these now match.
     */
    surface: { type: String as PropType<Surface>, default: 'modal' },
    captureReady: { type: Boolean, default: true },
    // The diagram's text source. Only PlantUML needs it today: its raster is
    // fetched from the PlantUML server rather than scraped off the DOM (see
    // useExportEngine's acquireBaseBlob).
    diagramSource: { type: String, default: '' },
  },
  emits: ['close', 'export', 'copy'],

  setup(props, { emit }) {
    const state = useExportState();
    const restored = readExportSession();
    if (restored) {
      state.annotations.items.value = restored.annotations;
      Object.assign(state.watermark, restored.watermark);
      state.watermarkVisible.value = restored.watermarkVisible;
      state.background.value = restored.background;
      state.customBgColor.value = restored.customBgColor;
    }
    watch(() => ({
      annotations: state.annotations.items.value.filter(item => (item.type !== 'note' && item.type !== 'callout') || item.text.trim()),
      watermark: state.watermark,
      watermarkVisible: state.watermarkVisible.value,
      background: state.background.value,
      customBgColor: state.customBgColor.value,
    }), writeExportSession, { deep: true, flush: 'sync' });
    provide(exportStateKey, state);
    const dialogEl = ref<HTMLElement | null>(null);
    const feedbackContext = ref<FeedbackContext | null>(null);
    let captureGen = 0;
    let exportSucceeded = false;
    let copiedTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let previouslyFocused: HTMLElement | null = null;

    const FOCUSABLE_SELECTOR = [
      'a[href]',
      'button:not([disabled])',
      'textarea:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '[tabindex]:not([tabindex="-1"])',
    ].join(',');

    function getFocusable(): HTMLElement[] {
      const root = dialogEl.value;
      if (!root) return [];
      return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    }

    function trapTab(event: KeyboardEvent) {
      const root = dialogEl.value;
      if (!root) return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        root.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (event.shiftKey) {
        if (active === first || active === root || !root.contains(active)) {
          event.preventDefault();
          last.focus();
        }
      } else if (active === last || active === root || !root.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    }

    // Escape layering: note editing is consumed by the input's own (.stop'd)
    // handler; the OverlayLayer SVG stops propagation when it clears a tool or
    // selection while focused. Anything reaching here clears a lingering
    // tool/selection (focus outside the SVG) or, when nothing is active,
    // closes the modal.
    function handleEscape() {
      if (state.noteEditing.value) {
        state.noteEditing.value = false;
        return;
      }
      if (state.activeTool.value) {
        state.activeTool.value = null;
        return;
      }
      if (state.selectedAnnotation.value) {
        state.selectedAnnotation.value = null;
        return;
      }
      emit('close');
    }

    function onDialogKeydown(event: KeyboardEvent) {
      if (event.key === 'Tab') {
        trapTab(event);
      } else if (event.key === 'Escape') {
        handleEscape();
      }
    }

    function restoreFocus() {
      const target = previouslyFocused;
      previouslyFocused = null;
      if (target && typeof target.focus === 'function' && document.contains(target)) {
        target.focus();
      }
    }

    // Null-safe fallback to the global selector so nothing regresses when the
    // getter isn't wired (stories/tests mounting ExportModal standalone).
    function resolveCaptureNode(): HTMLElement | null {
      return props.captureNodeGetter?.() ?? (document.querySelector('.screen-capture-content') as HTMLElement | null);
    }

    function buildExportContext(): ExportContext {
      return { macroType: props.macroType, source: props.diagramSource };
    }

    function buildExportOptions(): ExportOptions {
      return {
        annotations: state.annotations.items.value,
        background: state.background.value === 'custom' ? state.customBgColor.value : state.background.value,
        note: { text: state.note.text, position: state.note.position, fontSize: state.note.fontSize, color: state.note.color },
        arrow: { type: state.arrow.type, label: state.arrow.label, color: state.arrow.color, thickness: state.arrow.thickness },
        watermark: state.hasWatermark.value ? { text: state.watermark.text, opacity: state.watermark.opacity, fontSize: state.watermark.fontSize, color: state.watermark.color, position: state.watermark.position as 'diagonal' | 'bottom-right' } : null,
        callout: state.hasCallout.value ? { text: state.callout.text, fontSize: state.callout.fontSize, color: state.callout.color, bgColor: state.callout.bgColor, position: state.callout.position, tipPosition: state.callout.tipPosition } : null,
        arrowPoints: state.arrowPoints.value,
        notePoint: state.notePoint.value,
      };
    }

    function trackSucceeded(method: 'download' | 'clipboard') {
      trackAnalyticsEvent('export_png_succeeded', {
        feature_area: 'macro',
        surface: props.surface,
        macro_type: props.macroType,
        method,
        background: state.background.value,
        has_note: state.annotations.items.value.some(item => item.type === 'note'),
        has_arrow: state.annotations.items.value.some(item => item.type === 'arrow'),
        has_callout: state.annotations.items.value.some(item => item.type === 'callout'),
        has_rectangle: state.annotations.items.value.some(item => item.type === 'rectangle'),
        annotation_count: state.annotations.items.value.length + Number(state.hasWatermark.value),
        has_watermark: state.hasWatermark.value,
      });
    }

    function trackFailed(reason: string) {
      trackAnalyticsEvent('export_png_failed', {
        feature_area: 'macro',
        surface: props.surface,
        macro_type: props.macroType,
        failure_reason: reason,
      });
    }

    /**
     * Re-encode a captured data URL cropped to the node's measured content.
     * Returns null when there is nothing to crop or the image cannot be read,
     * so the caller falls back to the full capture.
     */
    async function cropDataUrl(dataUrl: string, node: HTMLElement): Promise<string | null> {
      const box = measureCaptureCrop(node);
      if (!box) return null;
      try {
        const image = await new Promise<HTMLImageElement>((resolve, reject) => {
          const img = new Image();
          img.onload = () => resolve(img);
          img.onerror = reject;
          img.src = dataUrl;
        });
        const full = document.createElement('canvas');
        full.width = image.naturalWidth;
        full.height = image.naturalHeight;
        const ctx = full.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(image, 0, 0);
        const scale = node.offsetWidth ? full.width / node.offsetWidth : 1;
        const cropped = cropCanvasToBox(full, box, scale);
        return cropped ? cropped.toDataURL('image/png') : null;
      } catch (error) {
        console.warn('[ExportModal] preview crop failed:', error);
        return null;
      }
    }

    function blobDataUrl(blob: Blob): Promise<string> {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('preview blob read failed'));
        reader.readAsDataURL(blob);
      });
    }

    // The preview <img> src when it is an object URL we minted (PlantUML), so
    // it can be revoked once replaced or the modal is torn down. The DOM
    // capture path passes data URLs, which need no revocation.
    let previewObjectUrl: string | null = null;
    function setPreviewUrl(url: string, isObjectUrl: boolean) {
      if (previewObjectUrl && previewObjectUrl !== url) URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = isObjectUrl ? url : null;
      state.previewDataUrl.value = url;
    }

    async function capturePreview() {
      // PlantUML previews the same server-rendered raster the export will
      // download: html-to-image cannot rasterize PlantUML's inlined remote SVG,
      // so the DOM path below previewed a blank image — which then had the user
      // distrusting a working export. It needs no capture node (like the export
      // path) and the server raster is already at the diagram's own bounds, so
      // it skips waitForCaptureAssets/cropDataUrl entirely.
      //
      // Resolved SYNCHRONOUSLY, before the first await: capturePreview must
      // still bail out without touching isCapturing/exportError when there is
      // no node, exactly as it did before. `isPlantUmlSource` is a string test;
      // the pako-backed encoder stays lazy inside fetchPlantUmlPngBlob.
      const usePlantUmlServer = props.macroType === 'plantuml' && isPlantUmlSource(props.diagramSource);
      const node = usePlantUmlServer ? null : resolveCaptureNode();
      if (!usePlantUmlServer && !node) return;

      const gen = ++captureGen;
      state.isCapturing.value = true;
      state.exportError.value = null;
      try {
        if (usePlantUmlServer) {
          const blob = await fetchPlantUmlPngBlob(props.diagramSource);
          if (blob && captureGen === gen) setPreviewUrl(URL.createObjectURL(blob), true);
          return;
        }

        await waitForCaptureAssets(node!);
        // The preview is allowed to fit a small source up to the available
        // canvas. Capture at 2x so that display-only enlargement stays sharp;
        // the export path captures the source independently at native pixels.
        const previewBlob = await captureBlob(node, {
          skipFonts: true,
          pixelRatio: 2,
          // Keep the cached base transparent. ExportWorkspace paints the
          // selected background behind it, so changing background never
          // leaves the preview baked to the color from initial capture.
        });
        if (!previewBlob) throw new Error('preview capture returned no blob');
        const dataUrl = await blobDataUrl(previewBlob);
        // Same crop as the export path, measured from the DOM. In fullscreen
        // the capture node is the layout column, so an uncropped preview shows
        // a small diagram stranded in viewport-wide whitespace — and every
        // annotation placed on it would be normalised against that column.
        const cropped = await cropDataUrl(dataUrl, node);
        if (captureGen === gen) setPreviewUrl(cropped ?? dataUrl, false);
      } catch (e) {
        console.warn('[ExportModal] preview capture failed:', e);
        if (captureGen === gen) state.exportError.value = EXPORT_ERROR_MESSAGE;
      } finally {
        if (captureGen === gen) state.isCapturing.value = false;
      }
    }

    async function captureExportWorkspace() {
      if (!dialogEl.value) throw new Error('FeedbackCaptureTargetUnavailable');
      return captureFeedbackElement(dialogEl.value);
    }

    watch(() => props.visible, async (val, previous) => {
      if (val) {
        previouslyFocused = document.activeElement as HTMLElement | null;
        exportSucceeded = false;
        state.exportError.value = null;
        state.copySucceeded.value = false;
        if (copiedTimeoutId) { clearTimeout(copiedTimeoutId); copiedTimeoutId = null; }
        trackAnalyticsEvent('export_png_opened', {
          feature_area: 'macro',
          surface: props.surface,
          macro_type: props.macroType,
        });
        if (state.annotations.items.value.length || state.hasWatermark.value) {
          trackAnalyticsEvent('export_annotations_restored', {
            feature_area: 'macro', surface: props.surface, macro_type: props.macroType,
            annotation_count: state.annotations.items.value.length + Number(state.hasWatermark.value),
          });
        }
        await nextTick();
        try {
          feedbackContext.value = deriveFeedbackContext(
            { ...(await getContext()), feedbackSurface: 'png_export' },
            store.state.diagram,
          );
        } catch {
          feedbackContext.value = null;
        }
        dialogEl.value?.focus();
        if (props.captureReady) capturePreview();
      } else if (previous) {
        if (!exportSucceeded) {
          trackAnalyticsEvent('export_png_dismissed', {
            feature_area: 'macro',
            surface: props.surface,
            macro_type: props.macroType,
          });
        }
        restoreFocus();
      }
    }, { immediate: true });

    watch(() => props.captureReady, (ready) => {
      if (ready && props.visible) capturePreview();
    });

    async function handleExport() {
      if (state.isExporting.value) return;
      state.isExporting.value = true;
      state.exportError.value = null;
      try {
        const { exportDiagram } = useExportEngine();
        const result = await exportDiagram(
          buildExportOptions(),
          props.diagramTitle,
          resolveCaptureNode(),
          buildExportContext(),
        );
        if (result.ok) {
          exportSucceeded = true;
          trackSucceeded('download');
          emit('close');
        } else {
          trackFailed(result.reason);
          state.exportError.value = EXPORT_ERROR_MESSAGE;
        }
      } catch (e) {
        console.error('[ExportModal] export failed:', e);
        trackFailed('exception');
        state.exportError.value = EXPORT_ERROR_MESSAGE;
      } finally {
        state.isExporting.value = false;
      }
    }

    async function handleCopy() {
      if (state.isCopying.value || state.isExporting.value) return;
      state.isCopying.value = true;
      state.exportError.value = null;
      try {
        const { exportDiagramToClipboard } = useExportEngine();
        const result = await exportDiagramToClipboard(
          buildExportOptions(),
          resolveCaptureNode(),
          buildExportContext(),
        );
        if (result.ok) {
          // A successful clipboard copy is a successful export for this open
          // session — mark it so closing afterwards doesn't fire dismissed.
          exportSucceeded = true;
          trackSucceeded('clipboard');
          state.copySucceeded.value = true;
          if (copiedTimeoutId) clearTimeout(copiedTimeoutId);
          copiedTimeoutId = setTimeout(() => { state.copySucceeded.value = false; }, COPIED_FEEDBACK_MS);
        } else {
          trackFailed(result.reason);
          state.exportError.value = EXPORT_ERROR_MESSAGE;
        }
      } catch (e) {
        console.error('[ExportModal] copy failed:', e);
        trackFailed('clipboard_denied');
        state.exportError.value = EXPORT_ERROR_MESSAGE;
      } finally {
        state.isCopying.value = false;
      }
    }

    onUnmounted(() => {
      if (copiedTimeoutId) clearTimeout(copiedTimeoutId);
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
        previewObjectUrl = null;
      }
    });

    return { state, dialogEl, feedbackContext, captureExportWorkspace, capturePreview, handleExport, handleCopy, onDialogKeydown };
  },
});
</script>

<style scoped>
/* ─── CSS Variables ─── */
/* Defined once here; .export-modal and its descendants (ExportPreview's
   .export-preview-pane, ExportSidebar's .export-sidebar) inherit these
   custom properties from the DOM tree — no need to redeclare per selector. */
.export-modal-backdrop {
  --modal-bg: #ffffff;
  --sidebar-bg: #0f172a;
  --sidebar-text: #e2e8f0;
  --sidebar-muted: #94a3b8;
  --sidebar-border: #1e293b;
  --sidebar-hover: #1e293b;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --danger: #ef4444;
}

/* ─── Backdrop ───
   The dialog is only ever opened inside the Forge Fullscreen modal now (the
   inline macro routes there — GenericViewer.openExport), and there is nothing
   behind it worth dimming: the surface underneath is a read-only copy of the
   same diagram. So it fills that modal rather than floating a 1100x720 card in
   it — measured 1920x950, the card left ~410px of dimmed backdrop on each side
   and the diagram no larger than in the old inline dialog. */
.export-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: var(--modal-bg);
  display: flex;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

/* ─── Modal shell ─── */
.export-modal {
  display: flex;
  width: 100%;
  height: 100%;
  background: var(--modal-bg);
  overflow: hidden;
}

/* ─── Vertical divider ─── */
.export-divider {
  width: 1px;
  background: var(--sidebar-border);
  flex-shrink: 0;
}

/* ─── Narrow surfaces ───
   Width only. The previous rule also stacked on `max-height: 600px`, which was
   written for the macro iframe and then fired on a 1280x563 Fullscreen modal —
   turning a laptop into a phone layout and clipping the annotation controls.
   Height decides nothing here; the sidebar scrolls instead. */
@media (max-width: 900px) {
  .export-modal {
    flex-direction: column;
  }
  .export-divider {
    width: auto;
    height: 1px;
  }
}

/* ─── Modal transition ─── */
.modal-enter-active,
.modal-leave-active {
  transition: opacity 0.2s ease;
}
.modal-enter-active .export-modal,
.modal-leave-active .export-modal {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.modal-enter-from,
.modal-leave-to {
  opacity: 0;
}
.modal-enter-from .export-modal,
.modal-leave-to .export-modal {
  opacity: 0;
  transform: scale(0.96) translateY(8px);
}

@media (prefers-reduced-motion: reduce) {
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .export-modal,
  .modal-leave-active .export-modal {
    transition-duration: 0.01ms !important;
  }
}
</style>

<style>
/* ─── Shared styles for sub-components (non-scoped) ─── */
/* CSS variables live once on .export-modal-backdrop (scoped style above)
   and inherit down to these panes — no redeclaration needed here. */

/* ─── Preview pane (left 60%) ─── */
/* The canvas takes everything the fixed sidebar does not. */
.export-preview-pane {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #f1f5f9;
}

.preview-header {
  padding: 10px 16px 10px;
  background: #ffffff;
  border-bottom: 1px solid #e2e8f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.preview-refresh {
  display: flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: 1px solid #e2e8f0;
  border-radius: 5px;
  padding: 4px 8px;
  font-size: 11px;
  color: #64748b;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
.preview-refresh:hover:not(:disabled) { border-color: #3b82f6; color: #3b82f6; }
.preview-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.9s linear infinite; }

.preview-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px; font-weight: 500;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: #94a3b8;
  display: flex; align-items: center; gap: 7px;
}
.preview-label::before {
  content: ''; display: inline-block; width: 6px; height: 6px; border-radius: 50%;
  background: #22d3ee; animation: livepulse 2s ease-in-out infinite;
}
@keyframes livepulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.4); }
  50% { opacity: 0.5; box-shadow: 0 0 0 4px rgba(34, 211, 238, 0); }
}

.preview-stage {
  flex: 1; display: flex; align-items: center; justify-content: center;
  padding: 16px; overflow: auto;
  background-image: radial-gradient(circle, #b6c4d4 1px, transparent 1px);
  background-size: 20px 20px; background-position: 0 0;
}

.preview-canvas-wrap {
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0,0,0,0.08);
  box-sizing: content-box;
  transform-origin: top left;
}

.preview-viewport { flex: 0 0 auto; }

.preview-canvas {
  position: relative; width: 100%;
  display: flex; align-items: center; justify-content: center;
  min-height: 120px;
}

.preview-diagram-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%;
}
.preview-diagram-label {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px;
  letter-spacing: 0.05em; color: #94a3b8;
}
.preview-real-diagram { display: block; width: 100%; height: 100%; object-fit: fill; }
.preview-loading { display: flex; align-items: center; justify-content: center; padding: 40px; }

/* ─── Sidebar ───
   A fixed 300px column rather than 40% of the surface: at 1920 the 40% column
   was 440px holding five controls, and the width is better spent on the
   diagram. 300px is measured against the reference products — Snagit's
   Properties column is 201px of a 913px editor (22%), and 300px lands at 23%
   of the 1280x563 modal and 16% of 1920x950, where 340px reached 27% at 1280,
   wider than Snagit's. CleanShot X has no side column at all: tools and their
   options share one ~40px top strip.
   min-height:0 is what makes the scroll region below actually scrollable
   inside a flex column — without it the wheel had no effect and only Tab-key
   scrollIntoView reached the lower controls. */
.export-sidebar {
  flex: 0 0 300px;
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  display: flex; flex-direction: column; min-width: 0; min-height: 0;
}

.sidebar-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px 14px; border-bottom: 1px solid var(--sidebar-border); flex-shrink: 0;
}
.sidebar-title {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 16px; font-weight: 700;
  color: #f1f5f9; margin: 0; letter-spacing: -0.01em;
}
.sidebar-close {
  background: none; border: none; color: var(--sidebar-muted);
  cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;
  transition: color 0.15s, background 0.15s;
}
.sidebar-close:hover { color: var(--sidebar-text); background: var(--sidebar-hover); }

.sidebar-scroll {
  flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px 0 16px;
  /* A visible thumb: the old #334155-on-#0f172a thumb was invisible even when
     the region did scroll, so nothing signalled that content continued. */
  scrollbar-width: thin; scrollbar-color: #64748b transparent;
}
.sidebar-scroll::-webkit-scrollbar { width: 4px; }
.sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
.sidebar-scroll::-webkit-scrollbar-thumb { background: #64748b; border-radius: 4px; }
.sidebar-scroll::-webkit-scrollbar-thumb:hover { background: #475569; }

.settings-section { padding: 16px 20px; border-bottom: 1px solid var(--sidebar-border); }
.settings-section:last-child { border-bottom: none; }

.section-heading {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 10px; font-weight: 500;
  letter-spacing: 0.12em; text-transform: uppercase; color: #94a3b8;
  margin: 0 0 12px; display: flex; align-items: center; gap: 8px;
}
.section-heading::before {
  content: ''; display: inline-block; width: 3px; height: 10px;
  background: var(--accent); border-radius: 2px; flex-shrink: 0; opacity: 1;
}

.bg-swatches { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.bg-swatch {
  min-width: 0; border-radius: 7px; border: 1px solid #334155; padding: 5px;
  background: #111c31; color: var(--sidebar-muted); cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s; text-align: left;
}
.bg-swatch:hover { transform: translateY(-1px); }
.bg-swatch.active { box-shadow: 0 0 0 2px var(--accent); border-color: var(--accent); }
.bg-swatch-preview {
  display: flex; flex-direction: column; justify-content: center; gap: 5px;
  height: 38px; padding: 0 9px; border-radius: 4px; overflow: hidden;
}
.bg-swatch-preview i { display: block; width: 74%; height: 2px; border-radius: 2px; background: #64748b; opacity: .7; }
.bg-swatch-preview i:last-child { width: 48%; }
.bg-swatch-label, .custom-color-label-text { display: block; padding-top: 4px; font-size: 10px; line-height: 1.2; }
.swatch-transparent {
  background-image:
    linear-gradient(45deg, #94a3b8 25%, transparent 25%), linear-gradient(-45deg, #94a3b8 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #94a3b8 75%), linear-gradient(-45deg, transparent 75%, #94a3b8 75%);
  background-size: 8px 8px; background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  background-color: #e2e8f0;
}
.custom-color-wrap { position: relative; grid-column: 1 / -1; }
.custom-color-label { cursor: pointer; display: flex; align-items: center; gap: 8px; color: var(--sidebar-muted); }
.custom-color-input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
.custom-color-swatch {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 6px; border: 1px dashed #475569;
  cursor: pointer; color: #64748b; transition: border-color 0.15s;
}
.custom-color-swatch:hover { border-color: var(--accent); color: var(--accent); }
.custom-color-label:focus-within .custom-color-swatch { box-shadow: 0 0 0 2px var(--accent); }
.custom-color-label-text { padding: 0; }

.field-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 10px;
}
.field-row:last-child { margin-bottom: 0; }
.field-label {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px; font-weight: 500;
  color: var(--sidebar-muted); flex-shrink: 0; display: flex; align-items: center; gap: 6px;
}
.field-value { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: #cbd5e1; font-weight: 600; }

.field-input {
  flex: 1; min-width: 0; background: var(--sidebar-border);
  border: 1px solid #334155; border-radius: 6px; padding: 6px 10px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px; color: var(--sidebar-text);
  outline: none; transition: border-color 0.15s;
}
.field-input::placeholder { color: #64748b; }
.field-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); }

.field-select {
  flex: 1; min-width: 0; background: var(--sidebar-border);
  border: 1px solid #334155; border-radius: 6px; padding: 6px 10px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px; color: var(--sidebar-text);
  outline: none; appearance: none; cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1L6 7L11 1' stroke='%2364748b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat; background-position: right 10px center; padding-right: 28px;
  transition: border-color 0.15s;
}
.field-select:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); }
.field-select option { background: #1e293b; color: var(--sidebar-text); }

.field-range {
  flex: 1; min-width: 0; -webkit-appearance: none; appearance: none;
  cursor: pointer; height: 4px; border-radius: 2px; background: #334155; outline: none;
}
.field-range::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none; width: 14px; height: 14px; border-radius: 50%;
  background: #3b82f6; border: 2px solid #0f172a; cursor: pointer;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3); transition: box-shadow 0.15s, transform 0.1s;
}
.field-range::-webkit-slider-thumb:hover { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.25); transform: scale(1.15); }
.field-range::-moz-range-thumb {
  width: 14px; height: 14px; border-radius: 50%; background: #3b82f6;
  border: 2px solid #0f172a; cursor: pointer; box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
}

.field-color {
  width: 32px; height: 28px; border: 1px solid #334155; border-radius: 6px;
  padding: 2px; background: var(--sidebar-border); cursor: pointer; outline: none;
}
.field-color:focus { box-shadow: 0 0 0 2px var(--accent); }

.toggle {
  position: relative; width: 36px; height: 20px; border-radius: 10px;
  background: #334155; border: none; cursor: pointer; transition: background 0.2s;
  flex-shrink: 0; padding: 0;
}
.toggle.on { background: var(--accent); }
.toggle:hover { background: #475569; }
.toggle.on:hover { background: #1d4ed8; }
.toggle:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.toggle-thumb {
  position: absolute; top: 3px; left: 3px; width: 14px; height: 14px;
  border-radius: 50%; background: #ffffff; transition: transform 0.2s; pointer-events: none;
}
.toggle.on .toggle-thumb { transform: translateX(16px); }

/* Stacked because the actions do not fit across a 300px column. DOM and visual
   order both put Download PNG first, followed by the secondary Copy action. */
.sidebar-actions {
  display: flex; flex-direction: column; align-items: stretch;
  padding: 14px 20px; background: var(--sidebar-bg);
  box-shadow: 0 -1px 0 #1e293b, 0 -8px 16px rgba(15, 23, 42, 0.6);
  flex-shrink: 0; gap: 8px;
}
.sidebar-actions button { justify-content: center; width: 100%; }
.btn-cancel {
  background: none; border: 1px solid #334155; border-radius: 8px;
  padding: 8px 14px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px;
  font-weight: 500; color: var(--sidebar-muted); cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.btn-cancel:hover { border-color: #475569; color: var(--sidebar-text); }

.note-position-controls { display: flex; gap: 6px; align-items: center; flex: 1; }
.btn-place-note {
  flex: 1; background: #1e293b; border: 1px solid #334155; border-radius: 6px;
  padding: 5px 10px; font-size: 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #94a3b8;
  cursor: pointer; transition: border-color 0.15s, color 0.15s, background 0.15s;
  display: flex; align-items: center; gap: 6px;
}
.btn-place-note:hover { border-color: var(--accent); color: #ffffff; }
.btn-place-note.active {
  border-color: var(--accent); color: #ffffff; background: rgba(59, 130, 246, 0.15);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.4); animation: pulse-ring 1.5s ease-in-out infinite;
}
@keyframes pulse-ring {
  0%, 100% { box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.4); }
  50% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15); }
}
.btn-clear-note {
  background: #1e293b; border: 1px solid #334155; border-radius: 6px;
  padding: 5px 8px; font-size: 12px; color: #94a3b8; cursor: pointer; line-height: 1;
}
.btn-clear-note:hover { border-color: #ef4444; color: #ef4444; }

.btn-export {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: none; border-radius: 8px; padding: 9px 20px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; font-weight: 700; color: #ffffff;
  white-space: nowrap;
  cursor: pointer; transition: box-shadow 0.2s, transform 0.15s; letter-spacing: 0.03em;
  display: flex; align-items: center; gap: 7px;
  box-shadow: 0 2px 12px rgba(59, 130, 246, 0.35);
}
.btn-export:hover { box-shadow: 0 4px 20px rgba(59, 130, 246, 0.55); transform: translateY(-1px); }
.btn-export:active { transform: translateY(1px); box-shadow: 0 1px 6px rgba(59, 130, 246, 0.3); }
.btn-export:disabled { opacity: 0.7; cursor: not-allowed; transform: none; box-shadow: none; }

@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
  .preview-label::before { animation: none; opacity: 0.8; }
  .btn-place-note.active { animation: none; }
}

@media (max-width: 900px) {
  .export-preview-pane {
    flex: 1 1 auto;
    min-height: 0;
  }
  .export-sidebar {
    flex: 0 0 auto;
    max-height: 60%;
    min-height: 260px;
  }
}
</style>
