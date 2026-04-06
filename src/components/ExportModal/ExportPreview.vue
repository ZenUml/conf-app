<template>
  <div class="export-preview-pane">
    <div class="preview-header">
      <span class="preview-label">Preview</span>
      <div class="annotation-toolbar">
        <button
          class="tool-btn"
          :class="{ active: state.activeTool.value === 'arrow' }"
          @click="toggleTool('arrow')"
          title="Arrow (drag to draw)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 13L13 3M13 3H6M13 3V10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button
          class="tool-btn"
          :class="{ active: state.activeTool.value === 'callout' }"
          @click="toggleTool('callout')"
          title="Callout (click to place)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><rect x="1" y="1" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M5 11L3 15L8 11" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
        </button>
        <button
          class="tool-btn"
          :class="{ active: state.activeTool.value === 'note' }"
          @click="toggleTool('note')"
          title="Note (click to place)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M2 3h12M2 7h8M2 11h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
        </button>
        <button
          class="tool-btn"
          :class="{ active: state.activeTool.value === 'watermark' }"
          @click="toggleWatermark"
          title="Watermark (toggle)"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M4 10h8M3 12h10M6 10V7a2 2 0 114 0v3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
      </div>
      <button class="preview-refresh" @click="$emit('refresh')" :disabled="state.isCapturing.value" title="Refresh preview">
        <svg :class="{ 'spin': state.isCapturing.value }" width="14" height="14" viewBox="0 0 14 14" fill="none">
          <path d="M12.5 7A5.5 5.5 0 1 1 7 1.5M12.5 1.5v4h-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>{{ state.isCapturing.value ? 'Capturing…' : 'Refresh' }}</span>
      </button>
    </div>
    <div class="preview-stage">
      <div class="preview-canvas-wrap" :style="state.previewCanvasStyle.value">
        <div class="preview-canvas">
          <div class="preview-diagram-placeholder">
            <div v-if="state.isCapturing.value" class="preview-loading">
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
            @keydown.escape="state.noteEditing.value = false"
            ref="noteEditInput"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, nextTick } from 'vue';
import { exportStateKey, type ActiveTool } from './useExportState';
import OverlayLayer from './OverlayLayer.vue';

export default defineComponent({
  name: 'ExportPreview',
  components: { OverlayLayer },

  inject: {
    state: {
      from: exportStateKey,
      default: () => {
        throw new Error('[ExportPreview] Missing export state injection');
      },
    },
  },

  emits: ['refresh'],

  computed: {
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

  methods: {
    toggleTool(tool: ActiveTool) {
      if (this.state.activeTool.value === tool) {
        this.state.activeTool.value = null;
      } else {
        this.state.activeTool.value = tool;
        this.state.selectedAnnotation.value = null;
      }
    },

    toggleWatermark() {
      if (this.state.hasWatermark.value) {
        this.state.removeAnnotation('watermark');
      } else {
        this.state.watermarkVisible.value = true;
        this.state.selectedAnnotation.value = 'watermark';
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
  font-family: 'Outfit', sans-serif;
  font-weight: 500;
  outline: none;
  min-width: 100px;
  text-align: center;
  box-shadow: 0 2px 8px rgba(0,0,0,0.15);
}
</style>
