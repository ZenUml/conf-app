<template>
  <Transition name="modal">
    <div v-if="visible" class="export-modal-backdrop" @click.self="$emit('close')">
      <div class="export-modal">
        <ExportPreview :state="state" @refresh="capturePreview" />
        <div class="export-divider"></div>
        <ExportSidebar :state="state" @close="$emit('close')" @export="handleExport" />
      </div>
    </div>
  </Transition>
</template>

<script lang="ts">
import { defineComponent, watch, provide } from 'vue';
import ExportPreview from './ExportPreview.vue';
import ExportSidebar from './ExportSidebar.vue';
import { exportStateKey, useExportState } from './useExportState';
import { useExportEngine } from './useExportEngine';

export default defineComponent({
  name: 'ExportModal',
  components: { ExportPreview, ExportSidebar },

  props: {
    visible: { type: Boolean, required: true },
  },
  emits: ['close', 'export'],

  setup(props, { emit }) {
    const state = useExportState();
    provide(exportStateKey, state);
    let captureGen = 0;

    async function capturePreview() {
      const node = document.querySelector('.screen-capture-content') as HTMLElement | null;
      if (!node) return;
      const gen = ++captureGen;
      state.isCapturing.value = true;
      try {
        const { toPng } = await import('html-to-image');
        const bgColor = state.resolvedBgColor.value === 'transparent' ? undefined : state.resolvedBgColor.value;
        const dataUrl = await toPng(node, { skipFonts: true, backgroundColor: bgColor ?? '#ffffff' });
        if (captureGen === gen) state.previewDataUrl.value = dataUrl;
      } catch (e) {
        console.warn('[ExportModal] preview capture failed:', e);
      } finally {
        if (captureGen === gen) state.isCapturing.value = false;
      }
    }

    watch(() => props.visible, async (val) => {
      if (val) {
        await Promise.resolve();
        capturePreview();
      }
    });

    async function handleExport() {
      if (state.isExporting.value) return;
      state.isExporting.value = true;
      try {
        const options = {
          background: state.background.value === 'custom' ? state.customBgColor.value : state.background.value,
          note: { text: state.note.text, position: state.note.position, fontSize: state.note.fontSize, color: state.note.color },
          arrow: { type: state.arrow.type, label: state.arrow.label, color: state.arrow.color, thickness: state.arrow.thickness },
          watermark: state.hasWatermark.value ? { text: state.watermark.text, opacity: state.watermark.opacity, fontSize: state.watermark.fontSize, color: state.watermark.color, position: state.watermark.position as 'diagonal' | 'bottom-right' } : null,
          callout: state.hasCallout.value ? { text: state.callout.text, fontSize: state.callout.fontSize, color: state.callout.color, bgColor: state.callout.bgColor, position: state.callout.position, tipPosition: state.callout.tipPosition } : null,
          arrowPoints: state.arrowPoints.value,
          notePoint: state.notePoint.value,
        };
        const { exportDiagram } = useExportEngine();
        await exportDiagram(options);
        emit('close');
      } finally {
        state.isExporting.value = false;
      }
    }

    return { state, capturePreview, handleExport };
  },
});
</script>

<style scoped>
/* ─── CSS Variables ─── */
.export-modal-backdrop,
.export-modal {
  --modal-bg: #ffffff;
  --sidebar-bg: #0f172a;
  --sidebar-text: #e2e8f0;
  --sidebar-muted: #64748b;
  --sidebar-border: #1e293b;
  --sidebar-hover: #1e293b;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --danger: #ef4444;
}

/* ─── Backdrop ─── */
.export-modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 9999;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(6px);
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: 'Outfit', sans-serif;
}

/* ─── Modal shell ─── */
.export-modal {
  display: flex;
  width: min(1100px, 95vw);
  height: min(720px, 90vh);
  background: var(--modal-bg);
  border-radius: 14px;
  overflow: hidden;
  box-shadow: 0 32px 80px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255,255,255,0.05);
}

/* ─── Vertical divider ─── */
.export-divider {
  width: 1px;
  background: var(--sidebar-border);
  flex-shrink: 0;
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
.export-preview-pane {
  --modal-bg: #ffffff;
  --sidebar-bg: #0f172a;
  --sidebar-text: #e2e8f0;
  --sidebar-muted: #64748b;
  --sidebar-border: #1e293b;
  --sidebar-hover: #1e293b;
  --accent: #3b82f6;
}
.export-sidebar {
  --modal-bg: #ffffff;
  --sidebar-bg: #0f172a;
  --sidebar-text: #e2e8f0;
  --sidebar-muted: #64748b;
  --sidebar-border: #1e293b;
  --sidebar-hover: #1e293b;
  --accent: #3b82f6;
  --accent-hover: #2563eb;
  --danger: #ef4444;
}

/* ─── Preview pane (left 60%) ─── */
.export-preview-pane {
  flex: 0 0 60%;
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
  font-family: 'Outfit', sans-serif;
}
.preview-refresh:hover:not(:disabled) { border-color: #3b82f6; color: #3b82f6; }
.preview-refresh:disabled { opacity: 0.5; cursor: not-allowed; }

@keyframes spin { to { transform: rotate(360deg); } }
.spin { animation: spin 0.9s linear infinite; }

.preview-label {
  font-family: 'JetBrains Mono', monospace;
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
  max-width: 100%; max-height: 100%;
}

.preview-canvas {
  position: relative; width: 100%;
  display: flex; align-items: center; justify-content: center;
  min-height: 120px;
}

.preview-diagram-placeholder {
  display: flex; flex-direction: column; align-items: center; gap: 12px; width: 100%;
}
.preview-diagram-label {
  font-family: 'JetBrains Mono', monospace; font-size: 11px;
  letter-spacing: 0.05em; color: #94a3b8;
}
.preview-real-diagram { display: block; max-width: 100%; height: auto; }
.preview-loading { display: flex; align-items: center; justify-content: center; padding: 40px; }
.arrow-cursor { cursor: crosshair; }

/* ─── Sidebar (right 40%) ─── */
.export-sidebar {
  flex: 0 0 40%;
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  display: flex; flex-direction: column; min-width: 0;
}

.sidebar-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 18px 20px 14px; border-bottom: 1px solid var(--sidebar-border); flex-shrink: 0;
}
.sidebar-title {
  font-family: 'Outfit', sans-serif; font-size: 16px; font-weight: 700;
  color: #f1f5f9; margin: 0; letter-spacing: -0.01em;
}
.sidebar-close {
  background: none; border: none; color: var(--sidebar-muted);
  cursor: pointer; padding: 4px; border-radius: 4px; display: flex; align-items: center;
  transition: color 0.15s, background 0.15s;
}
.sidebar-close:hover { color: var(--sidebar-text); background: var(--sidebar-hover); }

.sidebar-scroll {
  flex: 1; overflow-y: auto; padding: 8px 0 16px;
  scrollbar-width: thin; scrollbar-color: #334155 transparent;
}
.sidebar-scroll::-webkit-scrollbar { width: 4px; }
.sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
.sidebar-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
.sidebar-scroll::-webkit-scrollbar-thumb:hover { background: #475569; }

.settings-section { padding: 16px 20px; border-bottom: 1px solid var(--sidebar-border); }
.settings-section:last-child { border-bottom: none; }

.section-heading {
  font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 500;
  letter-spacing: 0.12em; text-transform: uppercase; color: #94a3b8;
  margin: 0 0 12px; display: flex; align-items: center; gap: 8px;
}
.section-heading::before {
  content: ''; display: inline-block; width: 3px; height: 10px;
  background: var(--accent); border-radius: 2px; flex-shrink: 0; opacity: 1;
}

.bg-swatches { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.bg-swatch {
  width: 32px; height: 32px; border-radius: 6px; border: 1px solid #334155;
  cursor: pointer; transition: transform 0.1s, box-shadow 0.1s; flex-shrink: 0;
}
.bg-swatch:hover { transform: scale(1.1); }
.bg-swatch.active { box-shadow: 0 0 0 2px var(--accent); border-color: var(--accent); transform: scale(1.05); }
.swatch-transparent {
  background-image:
    linear-gradient(45deg, #94a3b8 25%, transparent 25%), linear-gradient(-45deg, #94a3b8 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #94a3b8 75%), linear-gradient(-45deg, transparent 75%, #94a3b8 75%);
  background-size: 8px 8px; background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  background-color: #e2e8f0;
}
.custom-color-wrap { position: relative; }
.custom-color-label { cursor: pointer; }
.custom-color-input { position: absolute; width: 0; height: 0; opacity: 0; pointer-events: none; }
.custom-color-swatch {
  display: flex; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 6px; border: 1px dashed #475569;
  cursor: pointer; color: #64748b; transition: border-color 0.15s;
}
.custom-color-swatch:hover { border-color: var(--accent); color: var(--accent); }
.custom-color-label:focus-within .custom-color-swatch { box-shadow: 0 0 0 2px var(--accent); }

.field-row {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px; margin-bottom: 10px;
}
.field-row:last-child { margin-bottom: 0; }
.field-label {
  font-family: 'Outfit', sans-serif; font-size: 12px; font-weight: 500;
  color: var(--sidebar-muted); flex-shrink: 0; display: flex; align-items: center; gap: 6px;
}
.field-value { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #cbd5e1; font-weight: 600; }

.field-input {
  flex: 1; min-width: 0; background: var(--sidebar-border);
  border: 1px solid #334155; border-radius: 6px; padding: 6px 10px;
  font-family: 'Outfit', sans-serif; font-size: 12px; color: var(--sidebar-text);
  outline: none; transition: border-color 0.15s;
}
.field-input::placeholder { color: #475569; }
.field-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2); }

.field-select {
  flex: 1; min-width: 0; background: var(--sidebar-border);
  border: 1px solid #334155; border-radius: 6px; padding: 6px 10px;
  font-family: 'Outfit', sans-serif; font-size: 12px; color: var(--sidebar-text);
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

.sidebar-actions {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; background: var(--sidebar-bg);
  box-shadow: 0 -1px 0 #1e293b, 0 -8px 16px rgba(15, 23, 42, 0.6);
  flex-shrink: 0; gap: 8px;
}
.btn-cancel {
  background: none; border: 1px solid #334155; border-radius: 8px;
  padding: 8px 14px; font-family: 'Outfit', sans-serif; font-size: 13px;
  font-weight: 500; color: var(--sidebar-muted); cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.btn-cancel:hover { border-color: #475569; color: var(--sidebar-text); }

.note-position-controls { display: flex; gap: 6px; align-items: center; flex: 1; }
.btn-place-note {
  flex: 1; background: #1e293b; border: 1px solid #334155; border-radius: 6px;
  padding: 5px 10px; font-size: 12px; font-family: 'Outfit', sans-serif; color: #94a3b8;
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
  font-family: 'Outfit', sans-serif; font-size: 13px; font-weight: 700; color: #ffffff;
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
</style>
