<template>
  <div class="export-preview-pane">
    <div class="preview-header">
      <span class="preview-label">Preview</span>
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
            <img v-else-if="state.previewDataUrl.value" :src="state.previewDataUrl.value" class="preview-real-diagram" alt="Diagram preview" />
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
import { defineComponent, type PropType, nextTick, watch } from 'vue';
import type { ExportState } from './useExportState';
import OverlayLayer from './OverlayLayer.vue';

export default defineComponent({
  name: 'ExportPreview',
  components: { OverlayLayer },

  props: {
    state: {
      type: Object as PropType<ExportState>,
      required: true,
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
    onNoteEditInput(event: Event) {
      this.state.note.text = (event.target as HTMLInputElement).value;
    },
  },
});
</script>

<style scoped>
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
