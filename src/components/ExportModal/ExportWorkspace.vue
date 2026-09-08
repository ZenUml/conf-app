<template>
  <section class="export-workspace" aria-label="Export image" @keydown="onKeydown">
    <header role="toolbar" aria-label="Export tools" class="workspace-toolbar">
      <button aria-label="Close export" data-tooltip="Close" @click="$emit('close')"><AdsIcon glyph="cross" /></button>
      <span class="separator" />
      <button aria-label="Copy image" data-tooltip="Copy image" :disabled="busy || !clipboardSupported" @click="$emit('copy')"><AdsIcon :glyph="state.copySucceeded.value ? 'check' : 'copy'" /></button>
      <button aria-label="Download image" data-tooltip="Download image" :disabled="busy" @click="$emit('export')"><AdsIcon glyph="download" /></button>
      <span class="format-label">PNG</span>
      <span class="separator" />
      <button aria-label="Select annotations" data-tooltip="Select annotations" :aria-pressed="tool === null" @click="chooseTool(null)"><AdsIcon glyph="select" /></button>
      <button v-for="entry in tools" :key="entry.type" :aria-label="entry.label" :data-tooltip="entry.label" :aria-pressed="tool === entry.type" @click="chooseTool(entry.type)"><AdsIcon :glyph="entry.icon" /></button>
      <button aria-label="Add watermark" data-tooltip="Add watermark" :aria-pressed="watermarkSelected" @click="addWatermark"><AdsIcon glyph="stamp" /></button>
      <span class="toolbar-spacer" />
      <label class="background-control">Background
        <select aria-label="Image background" v-model="state.background.value">
          <option v-for="bg in state.backgrounds" :key="bg.value" :value="bg.value">{{ bg.label }}</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <input v-if="state.background.value === 'custom'" aria-label="Custom background color" type="color" v-model="state.customBgColor.value" />
      <span class="image-meta">{{ state.previewNaturalWidth.value }} × {{ state.previewNaturalHeight.value }}<small>Image size</small></span>
      <span class="image-meta">{{ Math.round(fit.scale * 100) }}%<small>Zoom</small></span>
    </header>
    <div ref="stage" class="workspace-stage" @pointerdown.self="deselect">
      <p v-if="waitingForPreview || state.isCapturing.value" role="status">Preparing preview…</p>
      <div v-else-if="state.previewDataUrl.value" class="image-surface" :style="{ width: fit.width + 'px', height: fit.height + 'px', background: state.resolvedBgColor.value }">
        <img :src="state.previewDataUrl.value" alt="Diagram preview" @load="imageLoaded" draggable="false" />
        <div class="rendered-annotations" aria-hidden="true" v-html="overlaySvg" />
        <svg ref="canvas" class="annotation-canvas" aria-label="Annotation canvas" tabindex="0" :viewBox="`0 0 600 ${viewHeight}`" :style="{cursor: tool ? 'crosshair' : 'default'}" @pointerdown="canvasDown" @pointermove="pointerMove" @pointerup="pointerUp" @pointercancel="pointerCancel">
          <g v-for="item in state.annotations.items.value" :key="item.id" :data-annotation-id="item.id" role="button" tabindex="0" :aria-label="`${item.type}: ${item.text || 'annotation'}`" :style="{pointerEvents: tool ? 'none' : 'auto'}" @pointerdown.stop="selectItem(item, $event)" @dblclick.stop="editText(item)" @keydown.enter.stop="editText(item)">
            <line v-if="item.type === 'arrow'" :x1="item.position.x * 600" :y1="item.position.y * viewHeight" :x2="item.end.x * 600" :y2="item.end.y * viewHeight" stroke="transparent" stroke-width="16" />
            <rect v-else v-bind="bounds(item)" :fill="item.type === 'rectangle' ? 'none' : 'transparent'" :stroke="selected?.id === item.id ? '#2563eb' : 'transparent'" :stroke-width="item.type === 'rectangle' && selected?.id !== item.id ? 12 : 1" stroke-dasharray="4 3" />
          </g>
          <g v-if="selected && !editingId" class="selection-handles">
            <circle v-if="selected.type === 'arrow' || selected.type === 'rectangle'" aria-label="Drag start handle" :cx="selected.position.x * 600" :cy="selected.position.y * viewHeight" r="5" @pointerdown.stop="startHandle('start', $event)" />
            <circle v-if="selected.type !== 'note'" aria-label="Drag end handle" :cx="selected.end.x * 600" :cy="selected.end.y * viewHeight" r="5" @pointerdown.stop="startHandle('end', $event)" />
          </g>
          <rect v-if="state.hasWatermark.value && !tool" aria-label="Select watermark" :x="state.watermark.position === 'diagonal' ? 180 : 380" :y="state.watermark.position === 'diagonal' ? viewHeight / 2 - 30 : viewHeight - 44" :width="state.watermark.position === 'diagonal' ? 240 : 210" height="40" fill="transparent" @pointerdown.stop="selectWatermark" />
        </svg>
        <input v-if="editingId && selected" ref="textInput" class="canvas-text-input" aria-label="Annotation text" :style="{ left: selected.position.x * 100 + '%', top: selected.position.y * 100 + '%', fontSize: selected.fontSize * fit.width / 600 + 'px' }" v-model="draftText" @blur="finishText" @keydown.enter.prevent.stop="finishText" @keydown.escape.prevent.stop="cancelText" />
      </div>
      <div v-else class="empty-preview"><p>No preview available</p><button aria-label="Refresh preview" data-tooltip="Refresh preview" @click="$emit('refresh')"><AdsIcon glyph="refresh" /></button></div>
      <div v-if="selected && !editingId" class="context-tools" aria-label="Annotation properties">
        <span>{{ selected.type === 'note' ? 'Text' : selected.type }}</span>
        <button v-if="selected.type === 'note' || selected.type === 'callout'" aria-label="Edit text" data-tooltip="Edit text" @click="editText(selected)"><AdsIcon glyph="text" /></button>
        <input aria-label="Annotation color" type="color" :value="selected.color" @change="changeStyle('color', ($event.target as HTMLInputElement).value)" />
        <label v-if="selected.type === 'note' || selected.type === 'callout'">Size <input aria-label="Font size" type="number" min="8" max="72" :value="selected.fontSize" @change="changeStyle('fontSize', Number(($event.target as HTMLInputElement).value))" /></label>
        <label v-if="selected.type === 'arrow' || selected.type === 'rectangle'">Width <input aria-label="Stroke width" type="number" min="1" max="12" :value="selected.thickness" @change="changeStyle('thickness', Number(($event.target as HTMLInputElement).value))" /></label>
        <select v-if="selected.type === 'arrow'" aria-label="Arrow direction" :value="selected.arrowType" @change="changeStyle('arrowType', ($event.target as HTMLSelectElement).value)"><option>→</option><option>←</option><option>←→</option></select>
        <input v-if="selected.type === 'callout'" aria-label="Callout fill" type="color" :value="selected.bgColor" @change="changeStyle('bgColor', ($event.target as HTMLInputElement).value)" />
        <button aria-label="Delete annotation" data-tooltip="Delete annotation" @click="deleteSelected"><AdsIcon glyph="trash" /></button>
      </div>
      <div v-if="watermarkSelected" class="context-tools" aria-label="Watermark properties" @change="track('changed', 'watermark', 'style')">
        <input aria-label="Watermark text" v-model="state.watermark.text" />
        <label>Opacity <input aria-label="Watermark opacity" type="range" min="1" max="100" v-model.number="state.watermark.opacity" /></label>
        <select aria-label="Watermark position" v-model="state.watermark.position"><option value="diagonal">Diagonal</option><option value="bottom-right">Bottom right</option></select>
        <button aria-label="Delete watermark" data-tooltip="Delete watermark" @click="removeWatermark"><AdsIcon glyph="trash" /></button>
      </div>
      <p v-if="state.exportError.value" role="alert">{{ state.exportError.value }}</p>
      <p v-if="state.copySucceeded.value" role="status">Image copied to clipboard</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, toRaw, nextTick, onMounted, onUnmounted } from 'vue';
import AdsIcon from './AdsIcon.vue';
import type { ExportState, Point } from './useExportState';
import type { Annotation, AnnotationType } from './useAnnotations';
import { isClipboardExportSupported, buildOverlaySvg } from './useExportEngine';
import { calculatePreviewFit } from './previewFit';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { Surface, MacroTypeValue } from '@/utils/analytics/catalog';

const props = defineProps<{ state: ExportState; waitingForPreview?: boolean; surface?: Surface; macroType?: MacroTypeValue }>();
const state = toRaw(props.state);
defineEmits(['close', 'copy', 'export', 'refresh']);
const tool = ref<AnnotationType | null>(null);
const watermarkSelected = ref(false);
const selected = state.annotations.selected;
const stage = ref<HTMLElement | null>(null);
const canvas = ref<SVGSVGElement | null>(null);
const textInput = ref<HTMLInputElement | null>(null);
const stageSize = ref({ width: 800, height: 600 });
const editingId = ref<string | null>(null);
const draftText = ref('');
const freshIds = new Set<string>();
let drag: { id: string; mode: 'create' | 'move' | 'start' | 'end'; origin: Point; position: Point; end: Point; pointerId: number } | null = null;
const viewHeight = computed(() => 600 * state.previewNaturalHeight.value / state.previewNaturalWidth.value);
const fit = computed(() => calculatePreviewFit(stageSize.value.width, stageSize.value.height - 80, state.previewNaturalWidth.value, state.previewNaturalHeight.value));
const overlaySvg = computed(() => buildOverlaySvg(600, viewHeight.value, {
  background: 'transparent', note: { ...state.note, text: '' }, arrow: state.arrow,
  annotations: state.annotations.items.value,
  watermark: state.hasWatermark.value ? state.watermark : null,
}));
let observer: ResizeObserver | undefined;
onMounted(() => {
  if (typeof ResizeObserver === 'undefined' || !stage.value) return;
  observer = new ResizeObserver(([entry]) => { stageSize.value = { width: entry.contentRect.width, height: entry.contentRect.height }; });
  observer.observe(stage.value);
});
onUnmounted(() => observer?.disconnect());
function imageLoaded(event: Event) {
  const img = event.target as HTMLImageElement;
  // Preview capture uses pixelRatio 2; source dimensions are reported separately.
  if (img.naturalWidth && img.naturalHeight) {
    state.previewNaturalWidth.value = img.naturalWidth / 2;
    state.previewNaturalHeight.value = img.naturalHeight / 2;
  }
}
function bounds(item: Annotation) {
  if (item.type === 'rectangle') return { x: Math.min(item.position.x, item.end.x) * 600, y: Math.min(item.position.y, item.end.y) * viewHeight.value, width: Math.abs(item.end.x - item.position.x) * 600, height: Math.abs(item.end.y - item.position.y) * viewHeight.value };
  const width = Math.max(24, item.text.length * item.fontSize * 0.65 + (item.type === 'callout' ? 28 : 8));
  const height = item.fontSize * 1.35 + (item.type === 'callout' ? 16 : 8);
  return { x: item.position.x * 600 - width / 2, y: item.position.y * viewHeight.value - height / 2, width, height };
}
function track(action: 'created' | 'changed' | 'deleted', type: AnnotationType | 'watermark', change?: 'text' | 'style' | 'move' | 'resize') {
  trackAnalyticsEvent(`export_annotation_${action}`, { feature_area: 'macro', surface: props.surface ?? 'modal', macro_type: props.macroType ?? 'none', annotation_type: type, annotation_count: state.annotations.items.value.length + Number(state.hasWatermark.value), ...(change ? { annotation_change: change } : {}) });
}
function point(event: PointerEvent) {
  const rect = canvas.value!.getBoundingClientRect();
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
}
function canvasDown(event: PointerEvent) {
  if (event.button !== 0 || editingId.value) return;
  // Keep the pointer's default focus action from blurring the inline editor
  // that is mounted/focused during this same gesture.
  event.preventDefault();
  if (tool.value === 'note' || tool.value === 'callout') {
    const item = state.annotations.add(tool.value, point(event));
    if (item.type === 'callout') state.annotations.update(item.id, { end: { x: item.position.x, y: Math.min(1, item.position.y + 0.15) } });
    freshIds.add(item.id);
    tool.value = null;
    editText(item);
  } else if (tool.value === 'arrow' || tool.value === 'rectangle') {
    const item = state.annotations.add(tool.value, point(event));
    beginDrag(item, 'create', event);
  } else deselect();
}
function selectItem(item: Annotation, event: PointerEvent) {
  if (tool.value || editingId.value) return;
  state.annotations.select(item.id);
  watermarkSelected.value = false;
  beginDrag(item, 'move', event);
}
function beginDrag(item: Annotation, mode: 'create' | 'move' | 'start' | 'end', event: PointerEvent) {
  if (event.button !== 0) return;
  drag = { id: item.id, mode, origin: point(event), position: { ...item.position }, end: { ...item.end }, pointerId: event.pointerId };
  canvas.value?.setPointerCapture?.(event.pointerId);
  canvas.value?.focus();
}
function startHandle(mode: 'start' | 'end', event: PointerEvent) {
  if (selected.value) beginDrag(selected.value, mode, event);
}
function pointerMove(event: PointerEvent) {
  if (!drag) return;
  const p = point(event);
  if (drag.mode === 'create' || drag.mode === 'end') state.annotations.update(drag.id, { end: p });
  else if (drag.mode === 'start') state.annotations.update(drag.id, { position: p });
  else {
    const item = state.annotations.items.value.find(item => item.id === drag!.id)!;
    const paired = item.type !== 'note';
    const dx = Math.max(-Math.min(drag.position.x, paired ? drag.end.x : drag.position.x), Math.min(1 - Math.max(drag.position.x, paired ? drag.end.x : drag.position.x), p.x - drag.origin.x));
    const dy = Math.max(-Math.min(drag.position.y, paired ? drag.end.y : drag.position.y), Math.min(1 - Math.max(drag.position.y, paired ? drag.end.y : drag.position.y), p.y - drag.origin.y));
    state.annotations.update(drag.id, { position: { x: drag.position.x + dx, y: drag.position.y + dy }, end: { x: drag.end.x + dx, y: drag.end.y + dy } });
  }
}
function pointerUp(event: PointerEvent) {
  if (!drag) return;
  pointerMove(event);
  const item = state.annotations.items.value.find(item => item.id === drag!.id)!;
  if (drag.mode === 'create') {
    const tiny = Math.hypot((item.end.x - item.position.x) * fit.value.width, (item.end.y - item.position.y) * fit.value.height) < 4;
    if (tiny) state.annotations.remove(item.id); else track('created', item.type);
    tool.value = null;
  } else if (JSON.stringify([item.position, item.end]) !== JSON.stringify([drag.position, drag.end])) track('changed', item.type, drag.mode === 'move' ? 'move' : 'resize');
  canvas.value?.releasePointerCapture?.(drag.pointerId);
  drag = null;
}
function pointerCancel() {
  if (!drag) return;
  if (drag.mode === 'create') state.annotations.remove(drag.id);
  else state.annotations.update(drag.id, { position: drag.position, end: drag.end });
  drag = null;
}
function selectWatermark() {
  deselect();
  watermarkSelected.value = true;
}
async function editText(item: Annotation) {
  if (item.type !== 'note' && item.type !== 'callout') return;
  state.annotations.select(item.id);
  draftText.value = item.text;
  editingId.value = item.id;
  await nextTick();
  textInput.value?.focus();
  textInput.value?.select();
}
function finishText() {
  const item = selected.value;
  if (!editingId.value || !item) return;
  const text = draftText.value.trim();
  const fresh = freshIds.delete(item.id);
  editingId.value = null;
  if (!text) {
    state.annotations.remove(item.id);
    if (!fresh) track('deleted', item.type);
  } else if (fresh || text !== item.text) {
    state.annotations.update(item.id, { text });
    track(fresh ? 'created' : 'changed', item.type, fresh ? undefined : 'text');
  }
  canvas.value?.focus();
}
function cancelText() {
  const id = editingId.value;
  editingId.value = null;
  if (id && freshIds.delete(id)) state.annotations.remove(id);
  canvas.value?.focus();
}
function deselect() {
  state.annotations.select(null);
  watermarkSelected.value = false;
}
function deleteSelected() {
  if (!selected.value) return;
  const item = selected.value;
  state.annotations.remove(item.id);
  track('deleted', item.type);
}
function changeStyle(key: 'color' | 'fontSize' | 'thickness' | 'arrowType' | 'bgColor', value: string | number) {
  if (!selected.value) return;
  if (key === 'fontSize') value = Math.max(8, Math.min(72, Number(value) || 14));
  if (key === 'thickness') value = Math.max(1, Math.min(12, Number(value) || 2));
  state.annotations.update(selected.value.id, { [key]: value });
  track('changed', selected.value.type, 'style');
}
function onKeydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement).matches('input,select,textarea')) return;
  if (event.key === 'Escape' && drag) { pointerCancel(); event.stopPropagation(); event.preventDefault(); return; }
  if (event.key === 'Escape' && (tool.value || selected.value || watermarkSelected.value)) {
    chooseTool(null); event.stopPropagation(); event.preventDefault();
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && (selected.value || watermarkSelected.value)) {
    if (watermarkSelected.value) removeWatermark(); else deleteSelected();
    event.preventDefault(); event.stopPropagation();
  }
}
const clipboardSupported = isClipboardExportSupported();
const busy = computed(() => props.waitingForPreview || state.isCapturing.value || state.isExporting.value || state.isCopying.value);
const tools = [
  { type: 'note', label: 'Add text', icon: 'text' },
  { type: 'arrow', label: 'Add arrow', icon: 'arrow' },
  { type: 'callout', label: 'Add callout', icon: 'comment' },
  { type: 'rectangle', label: 'Add rectangle', icon: 'rectangle' },
] as const;
function chooseTool(value: AnnotationType | null) {
  tool.value = value;
  watermarkSelected.value = false;
  state.annotations.select(null);
  if (value) trackAnalyticsEvent('export_annotation_tool_clicked', { feature_area: 'macro', surface: props.surface ?? 'modal', macro_type: props.macroType ?? 'none', tool: value });
}
function addWatermark() {
  chooseTool(null);
  const alreadyVisible = state.watermarkVisible.value;
  state.watermarkVisible.value = true;
  watermarkSelected.value = true;
  trackAnalyticsEvent('export_annotation_tool_clicked', { feature_area: 'macro', surface: props.surface ?? 'modal', macro_type: props.macroType ?? 'none', tool: 'watermark' });
  if (!alreadyVisible) track('created', 'watermark');
}
function removeWatermark() {
  state.watermarkVisible.value = false;
  watermarkSelected.value = false;
  track('deleted', 'watermark');
}
</script>

<style scoped>
.export-workspace { display:flex; flex-direction:column; width:100%; height:100%; min-height:0; color:#374151; font:13px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; }
.workspace-toolbar { height:56px; flex-shrink:0; display:flex; align-items:center; gap:8px; padding:0 16px; background:white; border-bottom:1px solid #e5e7eb; z-index:3; }
button { position:relative; border:0; border-radius:6px; background:transparent; color:#6b7280; width:32px; height:32px; display:inline-flex; align-items:center; justify-content:center; cursor:pointer; flex-shrink:0; }
button:hover,button[aria-pressed=true] { background:#f3f4f6; color:#374151; }
button:focus-visible, input:focus-visible,select:focus-visible { outline:2px solid #2563eb; outline-offset:2px; }
button:disabled { opacity:.4; cursor:default; }
button[data-tooltip]::after { content:attr(data-tooltip); position:absolute; left:50%; top:calc(100% + 8px); transform:translateX(-50%); padding:6px 8px; border-radius:4px; color:white; background:#111827; font-size:12px; white-space:nowrap; opacity:0; visibility:hidden; transition:opacity 150ms; pointer-events:none; z-index:10; }
button[data-tooltip]:hover::after,button[data-tooltip]:focus-visible::after { opacity:1; visibility:visible; }
.separator { height:24px; width:1px; background:#e5e7eb; margin:0 4px; }
.toolbar-spacer { flex:1; }
.format-label { font-size:12px; color:#6b7280; }
.image-meta { border-left:1px solid #e5e7eb; padding-left:16px; white-space:nowrap; font-size:12px; }
.image-meta small { display:block; color:#9ca3af; }
.background-control { display:flex; gap:6px; align-items:center; font-size:12px; }
input,select { border:1px solid #e5e7eb; border-radius:4px; padding:4px; background:white; color:#374151; max-width:160px; font:inherit; }
input[type=color] { width:28px; height:28px; padding:2px; }
.workspace-stage { position:relative; flex:1; min-height:0; display:flex; align-items:center; justify-content:center; background-color:#fafafa; background-image:conic-gradient(#f0f1f3 25%,transparent 0 50%,#f0f1f3 0 75%,transparent 0); background-size:16px 16px; }
.image-surface { position:relative; flex-shrink:0; box-shadow:0 1px 4px #0000001a; }
.image-surface > img { width:100%; height:100%; display:block; pointer-events:none; }
.rendered-annotations,.annotation-canvas { position:absolute; inset:0; width:100%; height:100%; }
.rendered-annotations { pointer-events:none; }
.rendered-annotations :deep(svg) { width:100%; height:100%; }
.annotation-canvas { touch-action:none; }
.annotation-canvas:focus { outline:none; }
.annotation-canvas g { cursor:move; }
.selection-handles circle { fill:white; stroke:#2563eb; stroke-width:1.5; cursor:crosshair; }
.canvas-text-input { position:absolute; transform:translate(-50%,-50%); min-width:100px; max-width:90%; text-align:center; border:1px solid #2563eb; z-index:1; }
.context-tools input[type=number] { width:48px; }
.empty-preview { text-align:center; }
.context-tools { position:absolute; top:12px; right:16px; display:flex; align-items:center; gap:8px; padding:6px 8px; background:white; box-shadow:0 1px 4px #0000001a; border:1px solid #e5e7eb; border-radius:6px; z-index:2; }
.context-tools label { display:flex; align-items:center; gap:4px; font-size:12px; }
.context-tools input[type=range] { width:72px; }
@media(max-width:900px) { .background-control { font-size:0; } .background-control select { font-size:12px; } .workspace-toolbar { gap:4px; padding:0 8px; } .image-meta { padding-left:8px; } }
</style>
