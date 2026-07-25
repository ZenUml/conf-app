<template>
  <div class="export-sidebar">
    <div class="sidebar-header">
      <h2 id="export-settings-title" class="sidebar-title">Export Settings</h2>
      <button class="sidebar-close" @click="$emit('close')" aria-label="Close">
        <AdsIcon glyph="cross" />
      </button>
    </div>

    <div class="sidebar-scroll">
      <!-- Background Section (always visible) -->
      <section class="settings-section">
        <h3 class="section-heading">Background</h3>
        <div class="bg-swatches">
          <button
            v-for="bg in state.backgrounds"
            :key="bg.value"
            type="button"
            class="bg-swatch"
            :class="{ active: state.background.value === bg.value, 'swatch-transparent': bg.value === 'transparent' }"
            :style="bg.value === 'transparent' ? {} : { backgroundColor: bg.color }"
            :title="bg.label"
            :aria-label="bg.label"
            :aria-pressed="state.background.value === bg.value"
            @click="state.selectBackground(bg.value)"
          ></button>
          <div class="custom-color-wrap">
            <label class="custom-color-label" title="Custom color">
              <input type="color" v-model="state.customBgColor.value" @input="state.selectBackground('custom')" class="custom-color-input" aria-label="Custom background color"/>
              <span class="custom-color-swatch" :style="{ backgroundColor: state.customBgColor.value }">
                <AdsIcon glyph="add" :size="12" />
              </span>
            </label>
          </div>
        </div>
      </section>

      <!-- Context-sensitive: Note properties (when note is selected) -->
      <section v-if="state.selectedAnnotation.value === 'note'" class="settings-section annotation-props">
        <h3 class="section-heading">Note Properties</h3>
        <div class="field-row">
          <label class="field-label" for="export-note-text">Text</label>
          <input id="export-note-text" type="text" v-model="state.note.text" class="field-input" placeholder="Note text..."/>
        </div>
        <div v-if="!state.notePoint.value" class="field-row">
          <label class="field-label" for="export-note-preset">Preset</label>
          <select id="export-note-preset" v-model="state.note.position" class="field-select">
            <option value="top-left">Top Left</option>
            <option value="top-center">Top Center</option>
            <option value="top-right">Top Right</option>
            <option value="bottom-left">Bottom Left</option>
            <option value="bottom-center">Bottom Center</option>
            <option value="bottom-right">Bottom Right</option>
          </select>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-note-fontsize">Font Size <span class="field-value">{{ state.note.fontSize }}px</span></label>
          <input id="export-note-fontsize" type="range" v-model.number="state.note.fontSize" min="10" max="24" class="field-range" :style="rangeTrackStyle(state.note.fontSize, 10, 24)" :aria-valuetext="`${state.note.fontSize}px`"/>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-note-color">Color</label>
          <input id="export-note-color" type="color" v-model="state.note.color" class="field-color"/>
        </div>
        <div class="field-row annotation-delete-row">
          <button class="btn-delete-annotation" @click="state.removeAnnotation('note')">
            <AdsIcon glyph="trash" :size="12" />
            Remove Note
          </button>
        </div>
      </section>

      <!-- Context-sensitive: Arrow properties (when arrow is selected) -->
      <section v-if="state.selectedAnnotation.value === 'arrow'" class="settings-section annotation-props">
        <h3 class="section-heading">Arrow Properties</h3>
        <div class="field-row">
          <label class="field-label" for="export-arrow-type">Type</label>
          <select id="export-arrow-type" v-model="state.arrow.type" class="field-select">
            <option value="→">→ Single (right)</option>
            <option value="←">← Single (left)</option>
            <option value="←→">←→ Double</option>
          </select>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-arrow-label">Label</label>
          <input id="export-arrow-label" type="text" v-model="state.arrow.label" class="field-input" placeholder="Optional label..."/>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-arrow-color">Color</label>
          <input id="export-arrow-color" type="color" v-model="state.arrow.color" class="field-color"/>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-arrow-thickness">Thickness <span class="field-value">{{ state.arrow.thickness }}px</span></label>
          <input id="export-arrow-thickness" type="range" v-model.number="state.arrow.thickness" min="1" max="6" class="field-range" :style="rangeTrackStyle(state.arrow.thickness, 1, 6)" :aria-valuetext="`${state.arrow.thickness}px`"/>
        </div>
        <div class="field-row annotation-delete-row">
          <button class="btn-delete-annotation" @click="state.removeAnnotation('arrow')">
            <AdsIcon glyph="trash" :size="12" />
            Remove Arrow
          </button>
        </div>
      </section>

      <!-- Context-sensitive: Callout properties (when callout is selected) -->
      <section v-if="state.selectedAnnotation.value === 'callout'" class="settings-section annotation-props">
        <h3 class="section-heading">Callout Properties</h3>
        <div class="field-row">
          <label class="field-label" for="export-callout-text">Text</label>
          <input id="export-callout-text" type="text" v-model="state.callout.text" class="field-input" placeholder="Label text..."/>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-callout-fontsize">Font Size <span class="field-value">{{ state.callout.fontSize }}px</span></label>
          <input id="export-callout-fontsize" type="range" v-model.number="state.callout.fontSize" min="10" max="24" class="field-range" :style="rangeTrackStyle(state.callout.fontSize, 10, 24)" :aria-valuetext="`${state.callout.fontSize}px`"/>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-callout-color">Text Color</label>
          <input id="export-callout-color" type="color" v-model="state.callout.color" class="field-color"/>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-callout-bgcolor">Background</label>
          <input id="export-callout-bgcolor" type="color" v-model="state.callout.bgColor" class="field-color"/>
        </div>
        <div class="field-row annotation-delete-row">
          <button class="btn-delete-annotation" @click="state.removeAnnotation('callout')">
            <AdsIcon glyph="trash" :size="12" />
            Remove Callout
          </button>
        </div>
      </section>

      <!-- Context-sensitive: Watermark properties (when watermark is selected) -->
      <section v-if="state.selectedAnnotation.value === 'watermark'" class="settings-section annotation-props">
        <h3 class="section-heading">Watermark Properties</h3>
        <div class="field-row">
          <label class="field-label" for="export-watermark-text">Text</label>
          <input id="export-watermark-text" type="text" v-model="state.watermark.text" class="field-input" placeholder="Confidential"/>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-watermark-opacity">Opacity <span class="field-value">{{ state.watermark.opacity }}%</span></label>
          <input id="export-watermark-opacity" type="range" v-model.number="state.watermark.opacity" min="5" max="50" class="field-range" :style="rangeTrackStyle(state.watermark.opacity, 5, 50)" :aria-valuetext="`${state.watermark.opacity}%`"/>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-watermark-fontsize">Font Size <span class="field-value">{{ state.watermark.fontSize }}px</span></label>
          <input id="export-watermark-fontsize" type="range" v-model.number="state.watermark.fontSize" min="12" max="48" class="field-range" :style="rangeTrackStyle(state.watermark.fontSize, 12, 48)" :aria-valuetext="`${state.watermark.fontSize}px`"/>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-watermark-color">Color</label>
          <input id="export-watermark-color" type="color" v-model="state.watermark.color" class="field-color"/>
        </div>
        <div class="field-row">
          <label class="field-label" for="export-watermark-position">Position</label>
          <select id="export-watermark-position" v-model="state.watermark.position" class="field-select">
            <option value="diagonal">Diagonal</option>
            <option value="bottom-right">Bottom Right</option>
          </select>
        </div>
        <div class="field-row annotation-delete-row">
          <button class="btn-delete-annotation" @click="state.removeAnnotation('watermark')">
            <AdsIcon glyph="trash" :size="12" />
            Remove Watermark
          </button>
        </div>
      </section>

      <!-- Hint when no annotation selected -->
      <section v-if="!state.selectedAnnotation.value" class="settings-section annotation-hint-section">
        <div class="annotation-hint">
          <AdsIcon glyph="info" style="opacity: 0.5" />
          <span>Use the toolbar above to add annotations. Select an annotation to edit its properties.</span>
        </div>
      </section>
    </div>

    <!-- Export error (surfaced when an export attempt fails) -->
    <div v-if="state.exportError.value" class="export-error" role="alert">
      {{ state.exportError.value }}
    </div>

    <!-- Action bar -->
    <div class="sidebar-actions">
      <button class="btn-cancel" @click="$emit('close')">Cancel</button>
      <div class="sidebar-actions-primary">
        <button
          v-if="clipboardExportSupported"
          type="button"
          class="btn-copy"
          @click="$emit('copy')"
          :disabled="state.isExporting.value || state.isCopying.value"
        >
          <svg v-if="state.isCopying.value" class="spin" width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="rgba(148,163,184,0.35)" stroke-width="2"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <AdsIcon v-else-if="state.copySucceeded.value" glyph="check" :size="13" />
          <AdsIcon v-else glyph="copy" :size="13" />
          {{ state.copySucceeded.value ? 'Copied' : (state.isCopying.value ? 'Copying…' : 'Copy image') }}
        </button>
        <button class="btn-export" @click="$emit('export')" :disabled="state.isExporting.value">
          <svg v-if="state.isExporting.value" class="spin" width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
            <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <AdsIcon v-else glyph="download" :size="13" />
          {{ state.isExporting.value ? 'Exporting…' : 'Download PNG' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { exportStateKey } from './useExportState';
import { isClipboardExportSupported } from './useExportEngine';
import AdsIcon from './AdsIcon.vue';

export default defineComponent({
  name: 'ExportSidebar',
  components: { AdsIcon },

  inject: {
    state: {
      from: exportStateKey,
      default: () => {
        throw new Error('[ExportSidebar] Missing export state injection');
      },
    },
  },

  emits: ['close', 'export', 'copy'],

  computed: {
    clipboardExportSupported(): boolean {
      return isClipboardExportSupported();
    },
  },

  methods: {
    rangeTrackStyle(value: number, min: number, max: number): Record<string, string> {
      const pct = ((value - min) / (max - min)) * 100;
      return { background: `linear-gradient(to right, #3b82f6 ${pct}%, #334155 ${pct}%)` };
    },
  },
});
</script>

<style scoped>
.annotation-props {
  background: rgba(59, 130, 246, 0.04);
}

.annotation-hint-section {
  border-bottom: none;
  padding-bottom: 20px;
}

.annotation-hint {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 12px;
  color: #94a3b8;
  line-height: 1.5;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}

.annotation-hint svg {
  flex-shrink: 0;
  margin-top: 1px;
}

.annotation-delete-row {
  justify-content: flex-end;
  margin-top: 4px;
}

.btn-delete-annotation {
  display: flex;
  align-items: center;
  gap: 5px;
  background: none;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 11px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  color: #94a3b8;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.btn-delete-annotation:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}

.sidebar-actions-primary {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-copy {
  display: flex;
  align-items: center;
  gap: 6px;
  background: none;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 8px 14px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--sidebar-muted);
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.15s, color 0.15s;
}
.btn-copy:hover:not(:disabled) { border-color: #475569; color: var(--sidebar-text); }
.btn-copy:disabled { opacity: 0.6; cursor: not-allowed; }

.export-error {
  flex-shrink: 0;
  padding: 10px 20px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-size: 12px;
  line-height: 1.4;
  color: var(--danger);
  background: rgba(239, 68, 68, 0.08);
  border-top: 1px solid var(--sidebar-border);
}
</style>
