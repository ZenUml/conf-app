<template>
  <section class="export-workspace" aria-label="Export image" :aria-busy="busy" @keydown="onKeydown">
    <header role="toolbar" aria-label="Export tools" class="workspace-toolbar">
      <button aria-label="Close export" data-tooltip="Close" @click="$emit('close')"><AdsIcon glyph="cross" /></button>
      <span class="separator" />
      <button aria-label="Copy image" data-tooltip="Copy image" :disabled="busy || !clipboardSupported" @click="$emit('copy')"><AdsIcon :glyph="state.copySucceeded.value ? 'check' : 'copy'" /></button>
      <button aria-label="Download image" data-tooltip="Download image" :disabled="busy" @click="$emit('export')"><AdsIcon glyph="download" /></button>
      <span class="format-label">PNG</span>
      <span v-if="busyLabel" class="busy-status" role="status"><span class="spinner" aria-hidden="true" />{{ busyLabel }}</span>
      <span class="separator" />
      <button aria-label="Select and move" data-tooltip="Select and move" :aria-pressed="tool === null && !watermarkSelected" @click="chooseTool(null)"><AdsIcon glyph="select" /></button>
      <button v-for="entry in tools" :key="entry.type" :aria-label="entry.label" :data-tooltip="entry.label" :aria-pressed="tool === entry.type" @click="chooseTool(entry.type)"><AdsIcon :glyph="entry.icon" /></button>
      <button aria-label="Add watermark" data-tooltip="Add watermark" :aria-pressed="watermarkSelected" @click="addWatermark"><AdsIcon glyph="stamp" /></button>
      <span class="separator" />
      <!-- Recovery must stay reachable while a preview is on screen: the export
           error tells the user to refresh, and the only Refresh used to live in
           the empty-preview placeholder they never see in that state. -->
      <button aria-label="Refresh preview" data-tooltip="Refresh preview" :disabled="busy" @click="$emit('refresh')"><AdsIcon glyph="refresh" /></button>
      <span class="toolbar-spacer" />
      <label class="background-control">Background
        <select aria-label="Image background" v-model="state.background.value" @change="backgroundMenu = false">
          <option v-for="bg in state.backgrounds" :key="bg.value" :value="bg.value">{{ bg.label }}</option>
          <option value="custom">Custom</option>
        </select>
      </label>
      <div v-if="state.background.value === 'custom'" class="color-control">
        <button type="button" class="color-swatch" aria-label="Custom background color" data-tooltip="Custom background color" :aria-expanded="backgroundMenu" :style="{ backgroundColor: state.customBgColor.value }" @click.stop="toggleBackgroundMenu" />
        <div v-if="backgroundMenu" class="color-menu" role="menu" aria-label="Custom background color choices">
          <button v-for="choice in BACKGROUND_CHOICES" :key="choice.value" type="button" role="menuitem" :aria-label="choice.label" :data-tooltip="choice.label" :aria-pressed="state.customBgColor.value === choice.value" class="color-choice" :style="{ backgroundColor: choice.value }" @click.stop="chooseBackgroundColor(choice.value)" />
          <input v-model="backgroundDraft" aria-label="Custom background hex" aria-describedby="background-format-error" :aria-invalid="!backgroundColorValid" class="color-hex" spellcheck="false" @keydown.enter.prevent="applyBackgroundColor" />
          <button type="button" class="color-apply" :disabled="!backgroundColorValid" @click.stop="applyBackgroundColor">Apply</button>
          <span v-if="!backgroundColorValid" id="background-format-error" class="color-format-error">Use #RRGGBB</span>
        </div>
      </div>
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
          <g v-if="state.hasWatermark.value" :transform="watermarkBox.transform">
            <rect v-if="!tool" aria-label="Select watermark" :x="watermarkBox.x" :y="watermarkBox.y" :width="watermarkBox.width" :height="watermarkBox.height" fill="transparent" @pointerdown.stop="selectWatermark" />
            <rect v-if="watermarkSelected" class="selection-outline" :x="watermarkBox.x" :y="watermarkBox.y" :width="watermarkBox.width" :height="watermarkBox.height" fill="none" stroke="#2563eb" stroke-width="1" stroke-dasharray="4 3" />
          </g>
        </svg>
        <input v-if="editingId && selected" ref="textInput" class="canvas-text-input" aria-label="Annotation text" :style="{ left: selected.position.x * 100 + '%', top: selected.position.y * 100 + '%', fontSize: selected.fontSize * fit.width / 600 + 'px' }" v-model="draftText" @blur="finishText" @keydown.enter.prevent.stop="finishText" @keydown.escape.prevent.stop="cancelText" />
      </div>
      <div v-else class="empty-preview"><p>No preview available</p><button aria-label="Refresh preview" data-tooltip="Refresh preview" @click="$emit('refresh')"><AdsIcon glyph="refresh" /></button></div>
      <div v-if="selected && !editingId" class="context-tools" aria-label="Annotation properties">
        <span>{{ selected.type === 'note' ? 'Text' : selected.type }}</span>
        <button v-if="selected.type === 'note' || selected.type === 'callout'" aria-label="Edit text" data-tooltip="Edit text" @click="editText(selected)"><AdsIcon glyph="text" /></button>
        <div class="color-control">
          <button type="button" class="color-swatch" aria-label="Annotation color" data-tooltip="Annotation color" :aria-expanded="colorMenu === 'color'" :style="{ backgroundColor: selected.color }" @click.stop="toggleColorMenu('color')" />
          <div v-if="colorMenu === 'color'" class="color-menu" role="menu" aria-label="Annotation color choices">
            <button v-for="choice in COLOR_CHOICES" :key="choice.value" type="button" role="menuitem" :aria-label="choice.label" :data-tooltip="choice.label" :aria-pressed="selected.color === choice.value" class="color-choice" :style="{ backgroundColor: choice.value }" @click.stop="chooseColor('color', choice.value)" />
            <input v-model="colorDraft" aria-label="Custom annotation color" aria-describedby="color-format-error" :aria-invalid="!customColorValid" class="color-hex" spellcheck="false" @keydown.enter.prevent="applyCustomColor('color')" />
            <button type="button" class="color-apply" :disabled="!customColorValid" @click.stop="applyCustomColor('color')">Apply</button>
            <span v-if="!customColorValid" id="color-format-error" class="color-format-error">Use #RRGGBB</span>
          </div>
        </div>
        <label v-if="selected.type === 'note' || selected.type === 'callout'">Size <input aria-label="Font size" type="number" min="8" max="72" :value="selected.fontSize" @change="changeStyle('fontSize', Number(($event.target as HTMLInputElement).value))" /></label>
        <label v-if="selected.type === 'arrow' || selected.type === 'rectangle'">Width <input aria-label="Stroke width" type="number" min="1" max="12" :value="selected.thickness" @change="changeStyle('thickness', Number(($event.target as HTMLInputElement).value))" /></label>
        <select v-if="selected.type === 'arrow'" aria-label="Arrow direction" :value="selected.arrowType" @change="changeStyle('arrowType', ($event.target as HTMLSelectElement).value)"><option>→</option><option>←</option><option>←→</option></select>
        <div v-if="selected.type === 'callout'" class="color-control">
          <button type="button" class="color-swatch" aria-label="Callout fill" data-tooltip="Callout fill" :aria-expanded="colorMenu === 'bgColor'" :style="{ backgroundColor: selected.bgColor }" @click.stop="toggleColorMenu('bgColor')" />
          <div v-if="colorMenu === 'bgColor'" class="color-menu" role="menu" aria-label="Callout fill choices">
            <button v-for="choice in COLOR_CHOICES" :key="choice.value" type="button" role="menuitem" :aria-label="choice.label" :data-tooltip="choice.label" :aria-pressed="selected.bgColor === choice.value" class="color-choice" :style="{ backgroundColor: choice.value }" @click.stop="chooseColor('bgColor', choice.value)" />
            <input v-model="colorDraft" aria-label="Custom callout fill" aria-describedby="color-format-error" :aria-invalid="!customColorValid" class="color-hex" spellcheck="false" @keydown.enter.prevent="applyCustomColor('bgColor')" />
            <button type="button" class="color-apply" :disabled="!customColorValid" @click.stop="applyCustomColor('bgColor')">Apply</button>
            <span v-if="!customColorValid" id="color-format-error" class="color-format-error">Use #RRGGBB</span>
          </div>
        </div>
        <button aria-label="Delete annotation" data-tooltip="Delete annotation" @click="deleteSelected"><AdsIcon glyph="trash" /></button>
      </div>
      <div v-if="watermarkSelected" class="context-tools" aria-label="Watermark properties" @change="track('changed', 'watermark', 'style')">
        <input aria-label="Watermark text" v-model="state.watermark.text" />
        <label>Opacity <input aria-label="Watermark opacity" type="range" min="1" max="100" v-model.number="state.watermark.opacity" /></label>
        <select aria-label="Watermark position" v-model="state.watermark.position"><option value="diagonal">Diagonal</option><option value="bottom-right">Bottom right</option></select>
        <button aria-label="Delete watermark" data-tooltip="Delete watermark" @click="removeWatermark"><AdsIcon glyph="trash" /></button>
      </div>
      <!-- Out of the stage's flex row on purpose: as a flex child the alert was
           squeezed into a clipped column at the right edge and pushed the
           preview off-centre. -->
      <p v-if="state.exportError.value" class="stage-message stage-message-error" role="alert">{{ state.exportError.value }}</p>
      <p v-else-if="state.copySucceeded.value" class="stage-message" role="status">Image copied to clipboard</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, toRaw, nextTick, onMounted, onUnmounted } from 'vue';
import AdsIcon from './AdsIcon.vue';
import type { ExportState, Point } from './useExportState';
import type { Annotation, AnnotationType } from './useAnnotations';
import { isClipboardExportSupported, buildOverlaySvg, measureTextWidth, watermarkGeometry } from './useExportEngine';
import { computeCalloutBox, computeTextBox, SANS_FONT_FAMILY } from './overlayGeometry';
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
const colorMenu = ref<'color' | 'bgColor' | null>(null);
const colorDraft = ref('');
const customColorValid = computed(() => /^#[0-9a-f]{6}$/i.test(colorDraft.value.trim()));
const backgroundMenu = ref(false);
const backgroundDraft = ref('');
const backgroundColorValid = computed(() => /^#[0-9a-f]{6}$/i.test(backgroundDraft.value.trim()));
const draftText = ref('');
const freshIds = new Set<string>();
const COLOR_CHOICES = [
  { value: '#111827', label: 'Ink' },
  { value: '#374151', label: 'Slate' },
  { value: '#6b7280', label: 'Gray' },
  { value: '#2563eb', label: 'Blue' },
  { value: '#16a34a', label: 'Green' },
  { value: '#f97316', label: 'Orange' },
  { value: '#dc2626', label: 'Red' },
  { value: '#ffffff', label: 'White' },
] as const;
const BACKGROUND_CHOICES = [
  { value: '#ffffff', label: 'White' },
  { value: '#fffbf0', label: 'Warm' },
  { value: '#f0f4ff', label: 'Cool' },
  { value: '#f5f5f5', label: 'Light gray' },
  { value: '#111827', label: 'Ink' },
  { value: '#0f172a', label: 'Slate' },
] as const;
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
// Character count times font size is not a width: `iiiiiiiiii` and
// `WWWWWWWWWW` measure nothing alike, so the dashed outline sat far from the
// glyphs and clicks near a wide letter missed the annotation entirely. Both
// the outline and the hit target now come from the same measurement and the
// same box helpers the rendered overlay draws from.
const textWidthCache = new Map<string, number>();
function measuredWidth(text: string, fontSize: number, fontFamily: string): number {
  const key = `${fontFamily}|${fontSize}|${text}`;
  let width = textWidthCache.get(key);
  if (width === undefined) {
    width = measureTextWidth(text, fontSize, fontFamily);
    textWidthCache.set(key, width);
  }
  return width;
}
function bounds(item: Annotation) {
  if (item.type === 'rectangle') return { x: Math.min(item.position.x, item.end.x) * 600, y: Math.min(item.position.y, item.end.y) * viewHeight.value, width: Math.abs(item.end.x - item.position.x) * 600, height: Math.abs(item.end.y - item.position.y) * viewHeight.value };
  // scale 1: the overlay's viewBox is always VIEWBOX_REF_W wide, exactly what
  // buildOverlaySvg draws into.
  // While this item is mid-edit, item.text is still the last committed value —
  // measure the live draft instead so the outline tracks what's being typed
  // rather than staying pinned to the pre-edit text until Enter commits it.
  const text = item.id === editingId.value ? draftText.value : item.text;
  const content = { textWidth: measuredWidth(text, item.fontSize, SANS_FONT_FAMILY), fontSize: item.fontSize };
  const box = item.type === 'callout' ? computeCalloutBox(1, content) : computeTextBox(1, content);
  return { x: item.position.x * 600 - box.width / 2, y: item.position.y * viewHeight.value - box.height / 2, width: box.width, height: box.height };
}
// The watermark is drawn rotated, so an axis-aligned rectangle over it covers
// the wrong pixels: the visible lower half of a diagonal watermark sat outside
// the old hit box. Both the outline and the hit target are placed in the
// watermark's own rotated frame instead.
const watermarkBox = computed(() => {
  const { text, position } = state.watermark;
  const diagonal = position === 'diagonal';
  // Same fitting the overlay/export applies, so the outline stays on the glyphs
  // when a long watermark is shrunk to fit the rotated bounds.
  const { fontSize, renderedWidth, padding } = watermarkGeometry(text, state.watermark.fontSize, diagonal, 600, viewHeight.value, 16);
  const width = renderedWidth + 12;
  const height = fontSize * 1.4;
  // Mirrors useExportEngine's watermark placement: centred for diagonal,
  // right-anchored on the baseline EDGE_PADDING-ish inset for bottom-right.
  const cx = diagonal ? 300 : 600 - padding - width / 2;
  const cy = diagonal ? viewHeight.value / 2 : viewHeight.value - padding - fontSize * 0.35;
  return {
    x: cx - width / 2,
    y: cy - height / 2,
    width,
    height,
    transform: diagonal ? `rotate(-45, ${cx}, ${cy})` : '',
  };
});
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
  colorMenu.value = null;
  colorDraft.value = '';
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
  colorMenu.value = null;
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
function toggleColorMenu(kind: 'color' | 'bgColor') {
  if (colorMenu.value !== kind) colorDraft.value = kind === 'color' ? selected.value?.color ?? '' : selected.value?.bgColor ?? '';
  colorMenu.value = colorMenu.value === kind ? null : kind;
}
function chooseColor(key: 'color' | 'bgColor', value: string) {
  changeStyle(key, value);
  colorMenu.value = null;
}
function applyCustomColor(key: 'color' | 'bgColor') {
  const value = colorDraft.value.trim();
  if (!/^#[0-9a-f]{6}$/i.test(value)) return;
  chooseColor(key, value.toLowerCase());
}
function toggleBackgroundMenu() {
  if (!backgroundMenu.value) backgroundDraft.value = state.customBgColor.value;
  backgroundMenu.value = !backgroundMenu.value;
}
function chooseBackgroundColor(value: string) {
  state.customBgColor.value = value;
  backgroundMenu.value = false;
}
function applyBackgroundColor() {
  const value = backgroundDraft.value.trim();
  if (!backgroundColorValid.value) return;
  state.customBgColor.value = value.toLowerCase();
  backgroundMenu.value = false;
}
function onKeydown(event: KeyboardEvent) {
  if ((event.target as HTMLElement).matches('input,select,textarea')) return;
  if (event.key === 'Escape' && drag) { pointerCancel(); event.stopPropagation(); event.preventDefault(); return; }
  if (event.key === 'Escape' && backgroundMenu.value) {
    backgroundMenu.value = false;
    event.stopPropagation();
    event.preventDefault();
  } else if (event.key === 'Escape' && colorMenu.value) {
    colorMenu.value = null;
    event.stopPropagation();
    event.preventDefault();
  } else if (event.key === 'Escape' && (tool.value || selected.value || watermarkSelected.value)) {
    // Escape is the explicit "drop everything" key, so it still clears the
    // selection that chooseTool(null) now preserves.
    chooseTool(null); deselect(); event.stopPropagation(); event.preventDefault();
  } else if ((event.key === 'Delete' || event.key === 'Backspace') && (selected.value || watermarkSelected.value)) {
    if (watermarkSelected.value) removeWatermark(); else deleteSelected();
    event.preventDefault(); event.stopPropagation();
  }
}
const clipboardSupported = isClipboardExportSupported();
const busy = computed(() => props.waitingForPreview || state.isCapturing.value || state.isExporting.value || state.isCopying.value);
// A dimmed button reads as "unavailable", not as "working" — the export used to
// run with no progress signal at all. The stage already announces its own
// "Preparing preview…", so this covers only the two actions the user starts.
const busyLabel = computed(() => {
  if (state.isExporting.value) return 'Exporting…';
  if (state.isCopying.value) return 'Copying…';
  return '';
});
const tools = [
  { type: 'note', label: 'Add text', icon: 'text' },
  { type: 'arrow', label: 'Add arrow', icon: 'arrow' },
  { type: 'callout', label: 'Add callout', icon: 'comment' },
  { type: 'rectangle', label: 'Add rectangle', icon: 'rectangle' },
] as const;
// Select is the select/move mode, not a "clear" button: returning to it from a
// drawing tool must leave the current selection — and its properties bar —
// standing, or the user loses what they were editing by putting the pen down.
// Arming a drawing tool still clears, because the next click creates something.
function chooseTool(value: AnnotationType | null) {
  tool.value = value;
  if (value) {
    watermarkSelected.value = false;
    state.annotations.select(null);
    trackAnalyticsEvent('export_annotation_tool_clicked', { feature_area: 'macro', surface: props.surface ?? 'modal', macro_type: props.macroType ?? 'none', tool: value });
  }
}
function addWatermark() {
  chooseTool(null);
  // The watermark becomes the selection, so nothing else may stay selected.
  state.annotations.select(null);
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
button[data-tooltip][aria-expanded=true]::after { opacity:0; visibility:hidden; }
.separator { height:24px; width:1px; background:#e5e7eb; margin:0 4px; }
.toolbar-spacer { flex:1; }
.format-label { font-size:12px; color:#6b7280; }
.busy-status { display:inline-flex; align-items:center; gap:6px; font-size:12px; color:#374151; white-space:nowrap; }
.spinner { width:12px; height:12px; border:2px solid #d1d5db; border-top-color:#2563eb; border-radius:50%; animation:workspace-spin 700ms linear infinite; }
@keyframes workspace-spin { to { transform:rotate(360deg); } }
@media(prefers-reduced-motion:reduce) { .spinner { animation-duration:2.4s; } }
.image-meta { border-left:1px solid #e5e7eb; padding-left:16px; white-space:nowrap; font-size:12px; }
.image-meta small { display:block; color:#9ca3af; }
.background-control { display:flex; gap:6px; align-items:center; font-size:12px; }
input,select { border:1px solid #e5e7eb; border-radius:4px; padding:4px; background:white; color:#374151; max-width:160px; font:inherit; }
input[type=color] { width:28px; height:28px; padding:2px; }
.color-control { position:relative; display:inline-flex; }
.color-swatch { width:28px; height:28px; padding:3px; border:1px solid #d1d5db; border-radius:4px; box-shadow:inset 0 0 0 1px white; }
.color-swatch:hover { border-color:#9ca3af; }
.color-menu { position:absolute; top:calc(100% + 6px); right:0; z-index:5; display:grid; grid-template-columns:repeat(4, 24px); gap:6px; padding:8px; border:1px solid #e5e7eb; border-radius:6px; background:white; box-shadow:0 4px 12px rgba(17,24,39,.15); }
.color-choice { width:24px; height:24px; padding:0; border:1px solid #d1d5db; border-radius:50%; box-shadow:inset 0 0 0 2px white; }
.color-choice[aria-pressed=true] { outline:2px solid #2563eb; outline-offset:2px; }
.color-hex { grid-column:span 3; width:88px; height:24px; box-sizing:border-box; padding:2px 5px; text-transform:lowercase; }
.color-apply { width:24px; height:24px; padding:0; font-size:10px; }
.color-format-error { grid-column:1 / -1; color:#b91c1c; font-size:10px; white-space:nowrap; }
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
.stage-message { position:absolute; left:50%; bottom:16px; transform:translateX(-50%); max-width:min(560px,calc(100% - 32px)); margin:0; padding:8px 12px; border-radius:6px; background:white; border:1px solid #e5e7eb; box-shadow:0 1px 4px #0000001a; text-align:center; line-height:1.4; z-index:2; }
.stage-message-error { border-color:#fecaca; background:#fef2f2; color:#b91c1c; }
.context-tools label { display:flex; align-items:center; gap:4px; font-size:12px; }
.context-tools input[type=range] { width:72px; }
@media(max-width:900px) { .background-control { font-size:0; } .background-control select { font-size:12px; } .workspace-toolbar { gap:4px; padding:0 8px; } .image-meta { padding-left:8px; } }
</style>
