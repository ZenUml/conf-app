<template>
  <svg
    v-if="hasAnyOverlay || isInteractive"
    class="overlay-layer"
    :viewBox="`0 0 ${viewBoxW} ${viewBoxH}`"
    preserveAspectRatio="xMidYMid meet"
    xmlns="http://www.w3.org/2000/svg"
    ref="overlayEl"
    :style="isInteractive ? 'pointer-events: auto; cursor: crosshair' : ''"
    @pointerdown="onSvgPointerDown"
    @pointermove="onSvgPointerMove"
    @pointerup="onSvgPointerUp"
    @keydown="onKeyDown"
    tabindex="0"
  >
    <defs>
      <filter id="drop-shadow-note" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="1" stdDeviation="2" flood-color="rgba(0,0,0,0.3)" flood-opacity="1"/>
      </filter>
    </defs>

    <!-- Note overlay -->
    <g v-if="state.note.text" class="note-overlay"
       @click.stop="state.selectedAnnotation.value = 'note'">
      <text
        :x="noteX"
        :y="noteY"
        :font-size="state.note.fontSize"
        :fill="state.note.color"
        font-family="'Outfit', sans-serif"
        font-weight="500"
        :text-anchor="noteAnchor"
        dominant-baseline="central"
        filter="url(#drop-shadow-note)"
        class="draggable-note"
        style="pointer-events: auto; cursor: grab"
        @pointerdown.stop="startNoteDrag"
        @dblclick.stop="startNoteEdit"
      >{{ state.note.text }}</text>
    </g>

    <!-- Arrow overlay -->
    <g v-if="state.arrowPoints.value" class="arrow-overlay"
       @click.stop="state.selectedAnnotation.value = 'arrow'">
      <!-- Start point dot (during creation) -->
      <circle
        v-if="state.arrowInteraction.value === 'creating'"
        :cx="arrowStartPx.x"
        :cy="arrowStartPx.y"
        :r="Math.max(4, state.arrow.thickness * 2)"
        :fill="state.arrow.color"
        opacity="0.6"
      />
      <!-- Arrow line -->
      <line
        v-if="state.arrowInteraction.value === 'creating' || state.arrowInteraction.value === 'placed'"
        :x1="arrowStartPx.x" :y1="arrowStartPx.y"
        :x2="arrowEndPx.x" :y2="arrowEndPx.y"
        :stroke="state.arrow.color"
        :stroke-width="state.arrow.thickness"
        stroke-linejoin="round"
        class="arrow-line-body"
        @pointerdown.stop="startArrowBodyDrag"
      />
      <!-- Invisible wider hit area for easier arrow body dragging -->
      <line
        v-if="state.arrowInteraction.value === 'placed'"
        :x1="arrowStartPx.x" :y1="arrowStartPx.y"
        :x2="arrowEndPx.x" :y2="arrowEndPx.y"
        stroke="transparent"
        :stroke-width="Math.max(12, state.arrow.thickness * 4)"
        class="arrow-hit-area"
        @pointerdown.stop="startArrowBodyDrag"
      />
      <!-- Arrowheads -->
      <path
        v-if="endHeadPath && (state.arrowInteraction.value === 'creating' || state.arrowInteraction.value === 'placed')"
        :d="endHeadPath"
        :fill="state.arrow.color"
        :stroke="state.arrow.color"
        stroke-linejoin="round"
      />
      <path
        v-if="startHeadPath && (state.arrowInteraction.value === 'creating' || state.arrowInteraction.value === 'placed')"
        :d="startHeadPath"
        :fill="state.arrow.color"
        :stroke="state.arrow.color"
        stroke-linejoin="round"
      />
      <!-- Arrow label -->
      <text
        v-if="state.arrow.label && state.arrowInteraction.value === 'placed'"
        :x="arrowLabelPos.x"
        :y="arrowLabelPos.y"
        :font-size="12 + state.arrow.thickness"
        :fill="state.arrow.color"
        font-family="'Outfit', sans-serif"
        text-anchor="middle"
        dominant-baseline="central"
      >{{ state.arrow.label }}</text>
      <!-- Grip handles (when arrow is selected/placed) -->
      <template v-if="state.selectedAnnotation.value === 'arrow' && state.arrowInteraction.value === 'placed'">
        <circle :cx="arrowStartPx.x" :cy="arrowStartPx.y" r="12" fill="transparent" class="grip-hit-area"
                @pointerdown.stop="startGripDrag('start', $event)" />
        <circle :cx="arrowStartPx.x" :cy="arrowStartPx.y" r="5" fill="#3b82f6" stroke="white" stroke-width="1.5" class="grip-handle" />
        <circle :cx="arrowEndPx.x" :cy="arrowEndPx.y" r="12" fill="transparent" class="grip-hit-area"
                @pointerdown.stop="startGripDrag('end', $event)" />
        <circle :cx="arrowEndPx.x" :cy="arrowEndPx.y" r="5" fill="#3b82f6" stroke="white" stroke-width="1.5" class="grip-handle" />
      </template>
    </g>

    <!-- Watermark overlay -->
    <g v-if="state.hasWatermark.value" class="watermark-overlay"
       style="pointer-events: auto; cursor: pointer"
       @click.stop="state.selectedAnnotation.value = 'watermark'">
      <text
        v-if="state.watermark.position === 'diagonal'"
        :x="viewBoxW / 2"
        :y="viewBoxH / 2"
        :font-size="state.watermark.fontSize"
        :fill="state.watermark.color"
        :opacity="state.watermark.opacity / 100"
        font-family="'JetBrains Mono', monospace"
        font-weight="500"
        text-anchor="middle"
        dominant-baseline="central"
        :transform="`rotate(-45, ${viewBoxW / 2}, ${viewBoxH / 2})`"
      >{{ state.watermark.text }}</text>
      <text
        v-else
        :x="viewBoxW - 16"
        :y="viewBoxH - 16"
        :font-size="state.watermark.fontSize"
        :fill="state.watermark.color"
        :opacity="state.watermark.opacity / 100"
        font-family="'JetBrains Mono', monospace"
        font-weight="500"
        text-anchor="end"
        dominant-baseline="auto"
      >{{ state.watermark.text }}</text>
    </g>

    <!-- Callout overlay -->
    <g v-if="state.hasCallout.value" class="callout-overlay"
       style="pointer-events: auto; cursor: move"
       @click.stop="state.selectedAnnotation.value = 'callout'"
       @pointerdown.stop="startCalloutBodyDrag">
      <path
        :d="calloutPath"
        :fill="state.callout.bgColor"
        stroke="#94a3b8"
        stroke-width="1"
        stroke-linejoin="round"
      />
      <text
        :x="calloutTextX"
        :y="calloutTextY"
        :font-size="state.callout.fontSize"
        :fill="state.callout.color"
        font-family="'Outfit', sans-serif"
        text-anchor="middle"
        dominant-baseline="central"
      >{{ state.callout.text }}</text>
      <!-- Tip grip -->
      <template v-if="state.selectedAnnotation.value === 'callout' && state.callout.tipPosition">
        <circle :cx="state.callout.tipPosition.x * viewBoxW" :cy="state.callout.tipPosition.y * viewBoxH"
                r="12" fill="transparent" class="grip-hit-area"
                @pointerdown.stop="startCalloutTipDrag" />
        <circle :cx="state.callout.tipPosition.x * viewBoxW" :cy="state.callout.tipPosition.y * viewBoxH"
                r="5" fill="#3b82f6" stroke="white" stroke-width="1.5" class="grip-handle" />
      </template>
    </g>
  </svg>

  <!-- Interaction hints -->
  <div v-if="state.activeTool.value === 'note'" class="arrow-click-hint">Click to place note</div>
  <div v-else-if="state.activeTool.value === 'callout'" class="arrow-click-hint">Click to place callout</div>
  <div v-else-if="state.activeTool.value === 'arrow' && state.arrowInteraction.value === 'idle'" class="arrow-click-hint">
    Drag to draw arrow
  </div>
  <div v-else-if="state.activeTool.value === 'arrow' && state.arrowInteraction.value === 'creating'" class="arrow-click-hint">
    Release to finish
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { exportStateKey, type Point } from './useExportState';

const VIEWBOX_REF_W = 600;
const VIEWBOX_DEFAULT_H = 400;

function computeArrowheadPath(
  tipX: number, tipY: number,
  angle: number, thickness: number,
): string {
  const arrowHeight = 10 + thickness * 2;
  const arrowWidth = Math.min(Math.max(5, thickness * 2), thickness + 5);
  const dipFactor = 0.7;
  const baseX = tipX - arrowHeight * dipFactor * Math.cos(angle);
  const baseY = tipY - arrowHeight * dipFactor * Math.sin(angle);
  const tipBaseX = tipX - arrowHeight * Math.cos(angle);
  const tipBaseY = tipY - arrowHeight * Math.sin(angle);
  const s1X = tipBaseX + arrowWidth * Math.sin(angle);
  const s1Y = tipBaseY - arrowWidth * Math.cos(angle);
  const s2X = tipBaseX - arrowWidth * Math.sin(angle);
  const s2Y = tipBaseY + arrowWidth * Math.cos(angle);
  return `M ${baseX} ${baseY} L ${s1X} ${s1Y} L ${tipX} ${tipY} L ${s2X} ${s2Y} Z`;
}

export default defineComponent({
  name: 'OverlayLayer',

  inject: {
    state: {
      from: exportStateKey,
      default: () => {
        throw new Error('[OverlayLayer] Missing export state injection');
      },
    },
  },

  data() {
    return {
      draggingGrip: null as 'start' | 'end' | null,
      draggingArrowBody: false,
      arrowBodyDragStart: null as Point | null,
      draggingCalloutTip: false,
      draggingCalloutBody: false,
      calloutBodyDragStart: null as Point | null,
    };
  },

  computed: {
    viewBoxW(): number {
      return VIEWBOX_REF_W;
    },

    viewBoxH(): number {
      const nw = this.state.previewNaturalWidth?.value;
      const nh = this.state.previewNaturalHeight?.value;
      if (!nw || !nh || nw <= 0) return VIEWBOX_DEFAULT_H;
      return Math.round(VIEWBOX_REF_W * nh / nw);
    },

    hasAnyOverlay(): boolean {
      return !!(
        this.state.note.text ||
        this.state.arrowPoints.value ||
        this.state.hasWatermark.value ||
        this.state.hasCallout.value
      );
    },

    isInteractive(): boolean {
      return this.state.activeTool.value === 'arrow' ||
        this.state.activeTool.value === 'note' ||
        this.state.activeTool.value === 'callout';
    },

    noteX(): number {
      if (this.state.notePoint.value) return this.state.notePoint.value.x * this.viewBoxW;
      const pos = this.state.note.position;
      if (pos.endsWith('left')) return 12;
      if (pos.endsWith('right')) return this.viewBoxW - 12;
      return this.viewBoxW / 2;
    },

    noteY(): number {
      if (this.state.notePoint.value) return this.state.notePoint.value.y * this.viewBoxH;
      return this.state.note.position.startsWith('top') ? 12 + this.state.note.fontSize : this.viewBoxH - 12;
    },

    noteAnchor(): string {
      if (this.state.notePoint.value) return 'middle';
      const pos = this.state.note.position;
      if (pos.endsWith('left')) return 'start';
      if (pos.endsWith('right')) return 'end';
      return 'middle';
    },

    arrowStartPx(): Point {
      const pts = this.state.arrowPoints.value;
      if (!pts) return { x: 0, y: 0 };
      return { x: pts.start.x * this.viewBoxW, y: pts.start.y * this.viewBoxH };
    },

    arrowEndPx(): Point {
      const pts = this.state.arrowPoints.value;
      if (!pts) return { x: 0, y: 0 };
      return { x: pts.end.x * this.viewBoxW, y: pts.end.y * this.viewBoxH };
    },

    arrowAngle(): number {
      return Math.atan2(this.arrowEndPx.y - this.arrowStartPx.y, this.arrowEndPx.x - this.arrowStartPx.x);
    },

    endHeadPath(): string {
      const t = this.state.arrow.type;
      if (t === '→' || t === '←→' || t === '⤷') {
        return computeArrowheadPath(this.arrowEndPx.x, this.arrowEndPx.y, this.arrowAngle, this.state.arrow.thickness);
      }
      return '';
    },

    startHeadPath(): string {
      const t = this.state.arrow.type;
      if (t === '←' || t === '←→') {
        return computeArrowheadPath(this.arrowStartPx.x, this.arrowStartPx.y, this.arrowAngle + Math.PI, this.state.arrow.thickness);
      }
      return '';
    },

    arrowLabelPos(): Point {
      const midX = (this.arrowStartPx.x + this.arrowEndPx.x) / 2;
      const midY = (this.arrowStartPx.y + this.arrowEndPx.y) / 2;
      const perpX = -Math.sin(this.arrowAngle) * 14;
      const perpY = Math.cos(this.arrowAngle) * 14;
      return { x: midX + perpX, y: midY + perpY };
    },

    calloutBoxW(): number { return 120; },
    calloutBoxH(): number { return 40; },

    calloutTextX(): number {
      if (!this.state.callout.position) return 0;
      return this.state.callout.position.x * this.viewBoxW;
    },

    calloutTextY(): number {
      if (!this.state.callout.position) return 0;
      return this.state.callout.position.y * this.viewBoxH;
    },

    calloutPath(): string {
      if (!this.state.callout.position) return '';
      const cx = this.state.callout.position.x * this.viewBoxW;
      const cy = this.state.callout.position.y * this.viewBoxH;
      const w = this.calloutBoxW;
      const h = this.calloutBoxH;
      const r = 5;
      const left = cx - w / 2;
      const top = cy - h / 2;
      const right = cx + w / 2;
      const bottom = cy + h / 2;

      let path = `M ${left + r} ${top} L ${right - r} ${top} Q ${right} ${top} ${right} ${top + r} L ${right} ${bottom - r} Q ${right} ${bottom} ${right - r} ${bottom}`;

      if (this.state.callout.tipPosition) {
        const tipX = this.state.callout.tipPosition.x * this.viewBoxW;
        const tipY = this.state.callout.tipPosition.y * this.viewBoxH;
        const baseLeft = cx - 8;
        const baseRight = cx + 8;
        path += ` L ${baseRight} ${bottom} L ${tipX} ${tipY} L ${baseLeft} ${bottom}`;
      }

      path += ` L ${left + r} ${bottom} Q ${left} ${bottom} ${left} ${bottom - r} L ${left} ${top + r} Q ${left} ${top} ${left + r} ${top} Z`;
      return path;
    },
  },

  methods: {
    getSvgCoords(event: PointerEvent): Point {
      const svg = this.$refs.overlayEl as SVGSVGElement;
      if (!svg) return { x: 0, y: 0 };
      const ctm = svg.getScreenCTM();
      if (ctm) {
        const pt = svg.createSVGPoint();
        pt.x = event.clientX;
        pt.y = event.clientY;
        const svgPt = pt.matrixTransform(ctm.inverse());
        return {
          x: Math.max(0, Math.min(1, svgPt.x / this.viewBoxW)),
          y: Math.max(0, Math.min(1, svgPt.y / this.viewBoxH)),
        };
      }
      const rect = svg.getBoundingClientRect();
      return {
        x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
      };
    },

    onSvgPointerDown(event: PointerEvent) {
      const target = event.target as SVGElement;
      const isOnAnnotation = target.closest('.note-overlay, .arrow-overlay, .watermark-overlay, .callout-overlay');
      const tool = this.state.activeTool.value;

      if (tool === 'note') {
        const coords = this.getSvgCoords(event);
        this.state.notePoint.value = coords;
        if (!this.state.note.text) {
          this.state.note.text = 'Note';
        }
        this.state.selectedAnnotation.value = 'note';
        this.state.activeTool.value = null;
        this.state.noteEditing.value = true;
        return;
      }

      if (tool === 'callout') {
        const coords = this.getSvgCoords(event);
        this.state.callout.position = coords;
        this.state.callout.tipPosition = {
          x: Math.min(1, coords.x + 0.1),
          y: Math.min(1, coords.y + 0.15),
        };
        if (!this.state.callout.text) {
          this.state.callout.text = 'Callout';
        }
        this.state.selectedAnnotation.value = 'callout';
        this.state.activeTool.value = null;
        return;
      }

      if (tool === 'arrow' && !isOnAnnotation) {
        const coords = this.getSvgCoords(event);
        this.state.arrowPoints.value = { start: coords, end: coords };
        this.state.arrowInteraction.value = 'creating';
        this.state.arrowClickCount.value = 1;
        this.state.selectedAnnotation.value = 'arrow';
        const svg = this.$refs.overlayEl as SVGSVGElement;
        svg.setPointerCapture(event.pointerId);
        return;
      }

      if (!isOnAnnotation) {
        this.state.selectedAnnotation.value = null;
      }
    },

    onSvgPointerMove(event: PointerEvent) {
      if (this.state.arrowInteraction.value === 'creating') {
        const coords = this.getSvgCoords(event);
        const start = this.state.arrowPoints.value!.start;
        this.state.arrowPoints.value = { start, end: coords };
        return;
      }

      if (this.draggingGrip && this.state.arrowPoints.value) {
        const coords = this.getSvgCoords(event);
        const pts = this.state.arrowPoints.value;
        if (this.draggingGrip === 'start') {
          this.state.arrowPoints.value = { start: coords, end: pts.end };
        } else {
          this.state.arrowPoints.value = { start: pts.start, end: coords };
        }
        return;
      }

      if (this.draggingArrowBody && this.state.arrowPoints.value && this.arrowBodyDragStart) {
        const coords = this.getSvgCoords(event);
        const dx = coords.x - this.arrowBodyDragStart.x;
        const dy = coords.y - this.arrowBodyDragStart.y;
        const pts = this.state.arrowPoints.value;
        this.state.arrowPoints.value = {
          start: { x: pts.start.x + dx, y: pts.start.y + dy },
          end: { x: pts.end.x + dx, y: pts.end.y + dy },
        };
        this.arrowBodyDragStart = coords;
        return;
      }

      if (this.state.noteDragging.value) {
        const coords = this.getSvgCoords(event);
        this.state.notePoint.value = coords;
        return;
      }

      if (this.draggingCalloutTip) {
        const coords = this.getSvgCoords(event);
        this.state.callout.tipPosition = coords;
        return;
      }

      if (this.draggingCalloutBody && this.calloutBodyDragStart && this.state.callout.position) {
        const coords = this.getSvgCoords(event);
        const dx = coords.x - this.calloutBodyDragStart.x;
        const dy = coords.y - this.calloutBodyDragStart.y;
        this.state.callout.position = {
          x: this.state.callout.position.x + dx,
          y: this.state.callout.position.y + dy,
        };
        if (this.state.callout.tipPosition) {
          this.state.callout.tipPosition = {
            x: this.state.callout.tipPosition.x + dx,
            y: this.state.callout.tipPosition.y + dy,
          };
        }
        this.calloutBodyDragStart = coords;
      }
    },

    onSvgPointerUp(event: PointerEvent) {
      if (this.state.arrowInteraction.value === 'creating') {
        const coords = this.getSvgCoords(event);
        const start = this.state.arrowPoints.value!.start;
        const dist = Math.sqrt(Math.pow(coords.x - start.x, 2) + Math.pow(coords.y - start.y, 2));
        if (dist < 0.01) {
          this.state.resetArrow();
          this.state.selectedAnnotation.value = null;
        } else {
          this.state.arrowPoints.value = { start, end: coords };
          this.state.arrowInteraction.value = 'placed';
          this.state.arrowClickCount.value = 2;
          this.state.activeTool.value = null;
        }
        return;
      }

      if (this.draggingGrip) {
        this.draggingGrip = null;
        return;
      }

      if (this.draggingArrowBody) {
        this.draggingArrowBody = false;
        this.arrowBodyDragStart = null;
        return;
      }

      if (this.state.noteDragging.value) {
        this.state.noteDragging.value = false;
        return;
      }

      if (this.draggingCalloutTip) {
        this.draggingCalloutTip = false;
        return;
      }

      if (this.draggingCalloutBody) {
        this.draggingCalloutBody = false;
        this.calloutBodyDragStart = null;
      }
    },

    onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        if (this.state.activeTool.value) {
          this.state.activeTool.value = null;
        } else {
          this.state.selectedAnnotation.value = null;
        }
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        const sel = this.state.selectedAnnotation.value;
        if (sel) {
          this.state.removeAnnotation(sel);
        }
      }
    },

    startNoteDrag(event: PointerEvent) {
      if (!this.state.notePoint.value) {
        this.state.notePoint.value = this.getSvgCoords(event);
      }
      this.state.noteDragging.value = true;
      this.state.selectedAnnotation.value = 'note';
      const svg = this.$refs.overlayEl as SVGSVGElement;
      svg.setPointerCapture(event.pointerId);
    },

    startNoteEdit() {
      this.state.noteEditing.value = true;
      this.state.selectedAnnotation.value = 'note';
    },

    startGripDrag(grip: 'start' | 'end', event: PointerEvent) {
      this.draggingGrip = grip;
      this.state.selectedAnnotation.value = 'arrow';
      const svg = this.$refs.overlayEl as SVGSVGElement;
      svg.setPointerCapture(event.pointerId);
    },

    startArrowBodyDrag(event: PointerEvent) {
      this.draggingArrowBody = true;
      this.arrowBodyDragStart = this.getSvgCoords(event);
      this.state.selectedAnnotation.value = 'arrow';
      const svg = this.$refs.overlayEl as SVGSVGElement;
      svg.setPointerCapture(event.pointerId);
    },

    startCalloutTipDrag(event: PointerEvent) {
      this.draggingCalloutTip = true;
      const svg = this.$refs.overlayEl as SVGSVGElement;
      svg.setPointerCapture(event.pointerId);
    },

    startCalloutBodyDrag(event: PointerEvent) {
      if ((event.target as SVGElement).closest('.grip-hit-area')) return;
      this.draggingCalloutBody = true;
      this.calloutBodyDragStart = this.getSvgCoords(event);
      this.state.selectedAnnotation.value = 'callout';
      const svg = this.$refs.overlayEl as SVGSVGElement;
      svg.setPointerCapture(event.pointerId);
    },
  },
});
</script>

<style scoped>
.overlay-layer {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
  outline: none;
}

.overlay-layer .note-overlay text,
.overlay-layer .arrow-overlay .grip-hit-area,
.overlay-layer .arrow-overlay .arrow-hit-area,
.overlay-layer .arrow-overlay .arrow-line-body,
.overlay-layer .callout-overlay .grip-hit-area {
  pointer-events: auto;
}

.draggable-note { cursor: grab; }
.draggable-note:active { cursor: grabbing; }
.grip-hit-area { cursor: grab; }
.grip-handle { pointer-events: none; }
.arrow-line-body { cursor: move; }
.arrow-hit-area { cursor: move; }

.arrow-click-hint {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(59, 130, 246, 0.9);
  color: white;
  font-size: 11px;
  font-weight: 500;
  font-family: 'Outfit', sans-serif;
  padding: 5px 12px;
  border-radius: 20px;
  pointer-events: none;
  white-space: nowrap;
  box-shadow: 0 2px 8px rgba(59,130,246,0.4);
  letter-spacing: 0.02em;
}
</style>
