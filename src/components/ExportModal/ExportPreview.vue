<template>
  <div class="export-preview-pane">
    <div class="preview-header">
      <span class="preview-label">Preview</span>
      <div class="annotation-toolbar">
        <button
          type="button"
          class="tool-btn"
          :class="{ active: isToolActive('arrow') }"
          @click="toggleTool('arrow')"
          title="Arrow (drag to draw)"
          aria-label="Arrow (drag to draw)"
          :aria-pressed="isToolActive('arrow')"
        >
          <AdsIcon glyph="arrow" />
        </button>
        <button
          type="button"
          class="tool-btn"
          :class="{ active: isToolActive('callout') }"
          @click="toggleTool('callout')"
          title="Callout (click to place)"
          aria-label="Callout (click to place)"
          :aria-pressed="isToolActive('callout')"
        >
          <AdsIcon glyph="comment" />
        </button>
        <button
          type="button"
          class="tool-btn"
          :class="{ active: isToolActive('note') }"
          @click="toggleTool('note')"
          title="Note (click to place)"
          aria-label="Note (click to place)"
          :aria-pressed="isToolActive('note')"
        >
          <AdsIcon glyph="text" />
        </button>
        <button
          type="button"
          class="tool-btn"
          :class="{ active: state.hasWatermark.value }"
          @click="toggleWatermark"
          title="Watermark (toggle)"
          aria-label="Watermark (toggle)"
          :aria-pressed="state.hasWatermark.value"
        >
          <AdsIcon glyph="lock" />
        </button>
      </div>
      <button class="preview-refresh" @click="$emit('refresh')" :disabled="state.isCapturing.value" title="Refresh preview">
        <AdsIcon :class="{ 'spin': state.isCapturing.value }" glyph="refresh" :size="14" />
        <span>{{ state.isCapturing.value ? 'Capturing…' : 'Refresh' }}</span>
      </button>
    </div>
    <div ref="previewStage" class="preview-stage">
      <div class="preview-viewport" :style="previewViewportStyle">
      <div class="preview-canvas-wrap" :style="previewCanvasStyle">
        <div class="preview-canvas">
          <div class="preview-diagram-placeholder">
            <div v-if="waitingForPreview || state.isCapturing.value" class="preview-loading">
              <svg class="spin" width="24" height="24" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="#334155" stroke-width="2"/>
                <path d="M12 2a10 10 0 0 1 10 10" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>
              </svg>
            </div>
            <img v-else-if="state.previewDataUrl.value" :src="state.previewDataUrl.value" class="preview-real-diagram" alt="Diagram preview" @load="onImageLoad" />
            <span v-else class="preview-diagram-label">No preview available</span>
          </div>

          <OverlayLayer :state="state" />

          <!-- In-place note editing overlay (above SVG) -->
          <input
            v-if="state.noteEditing.value && state.notePoint.value"
            class="note-edit-input"
            :style="noteEditStyle"
            :value="state.note.text"
            @input="onNoteEditInput"
            @blur="state.noteEditing.value = false"
            @keydown.enter="state.noteEditing.value = false"
            @keydown.escape.stop="state.noteEditing.value = false"
            ref="noteEditInput"
          />
        </div>
      </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, nextTick, type PropType } from 'vue';
import { exportStateKey, type ActiveTool } from './useExportState';
import OverlayLayer from './OverlayLayer.vue';
import AdsIcon from './AdsIcon.vue';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import type { MacroTypeValue, Surface } from '@/utils/analytics/catalog';
import { calculatePreviewFit } from './previewFit';

const CANVAS_PADDING = 32;

export default defineComponent({
  name: 'ExportPreview',
  components: { OverlayLayer, AdsIcon },

  props: {
    waitingForPreview: { type: Boolean, default: false },
    // Analytics context for export_annotation_tool_clicked. Passed down rather
    // than inferred here: this component has no view of the macro surface, and
    // an intent event without the surface cannot separate inline annotation
    // intent from Fullscreen intent — the comparison the event exists for.
    surface: { type: String as PropType<Surface>, default: 'modal' },
    macroType: { type: String as PropType<MacroTypeValue>, default: 'none' },
  },

  inject: {
    state: {
      from: exportStateKey,
      default: () => {
        throw new Error('[ExportPreview] Missing export state injection');
      },
    },
  },

  emits: ['refresh'],

  data() {
    return {
      previewStageWidth: 0,
      previewStageHeight: 0,
      previewResizeObserver: null as ResizeObserver | null,
    };
  },

  computed: {
    previewFit() {
      return calculatePreviewFit(
        this.previewStageWidth,
        this.previewStageHeight,
        this.state.previewNaturalWidth.value + CANVAS_PADDING,
        this.state.previewNaturalHeight.value + CANVAS_PADDING,
      );
    },

    previewViewportStyle(): Record<string, string> {
      return {
        width: `${this.previewFit.width}px`,
        height: `${this.previewFit.height}px`,
      };
    },

    previewCanvasStyle(): Record<string, string> {
      return {
        ...this.state.previewCanvasStyle.value,
        width: `${this.state.previewNaturalWidth.value}px`,
        height: `${this.state.previewNaturalHeight.value}px`,
        transform: `scale(${this.previewFit.scale})`,
      };
    },

    noteEditStyle(): Record<string, string> {
      if (!this.state.notePoint.value) return {};
      return {
        position: 'absolute',
        left: `${this.state.notePoint.value.x * 100}%`,
        top: `${this.state.notePoint.value.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        fontSize: `${this.state.note.fontSize}px`,
        color: this.state.note.color,
        zIndex: '10',
      };
    },
  },

  watch: {
    'state.noteEditing.value'(editing: boolean) {
      if (editing) {
        nextTick(() => {
          const input = this.$refs.noteEditInput as HTMLInputElement | undefined;
          input?.focus();
          input?.select();
        });
      }
    },
  },

  mounted() {
    const stage = this.$refs.previewStage as HTMLElement | undefined;
    if (!stage) return;
    const measure = () => {
      this.previewStageWidth = stage.clientWidth;
      this.previewStageHeight = stage.clientHeight;
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      this.previewResizeObserver = new ResizeObserver(measure);
      this.previewResizeObserver.observe(stage);
    }
  },

  beforeUnmount() {
    this.previewResizeObserver?.disconnect();
  },

  methods: {
    // Activation only — turning a tool back off is not a second intent, and
    // counting it would inflate the very number this event exists to read.
    trackToolIntent(tool: 'arrow' | 'callout' | 'note' | 'watermark') {
      trackAnalyticsEvent('export_annotation_tool_clicked', {
        feature_area: 'macro',
        surface: this.surface,
        macro_type: this.macroType,
        tool,
      });
    },

    /**
     * A tool reads as active while it is armed AND while the annotation it
     * placed is the current selection. Placing an annotation clears
     * activeTool, so binding to that alone left all four buttons looking
     * identical at the exact moment the user is editing one of them.
     */
    isToolActive(tool: 'arrow' | 'callout' | 'note') {
      return this.state.activeTool.value === tool
        || this.state.selectedAnnotation.value === tool;
    },

    toggleTool(tool: ActiveTool) {
      if (this.state.activeTool.value === tool) {
        this.state.activeTool.value = null;
      } else if (this.state.selectedAnnotation.value === tool) {
        this.state.selectedAnnotation.value = null;
      } else {
        this.state.activeTool.value = tool;
        this.state.selectedAnnotation.value = null;
        if (tool) this.trackToolIntent(tool);
      }
    },

    toggleWatermark() {
      if (this.state.hasWatermark.value) {
        this.state.removeAnnotation('watermark');
      } else {
        this.state.watermarkVisible.value = true;
        this.state.selectedAnnotation.value = 'watermark';
        this.trackToolIntent('watermark');
      }
    },

    onImageLoad(event: Event) {
      const img = event.target as HTMLImageElement;
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        this.state.previewNaturalWidth.value = img.naturalWidth;
        this.state.previewNaturalHeight.value = img.naturalHeight;
      }
    },

    onNoteEditInput(event: Event) {
      this.state.note.text = (event.target as HTMLInputElement).value;
    },
  },
});
</script>

<style scoped>
.annotation-toolbar {
  display: flex;
  gap: 2px;
  background: #f1f5f9;
  border-radius: 6px;
  padding: 2px;
}

.tool-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 30px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.tool-btn:hover {
  background: #e2e8f0;
  color: #334155;
}
.tool-btn.active {
  background: #3b82f6;
  color: #ffffff;
  box-shadow: 0 1px 3px rgba(59,130,246,0.3);
}

.note-edit-input {
  background: rgba(255, 255, 255, 0.95);
  border: 2px solid #3b82f6;
  border-radius: 4px;
  padding: 4px 8px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-weight: 500;
  outline: none;
  min-width: 100px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
</style>
