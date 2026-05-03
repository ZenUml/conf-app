<template>
  <div class="export-sidebar">
    <div class="sidebar-header">
      <h2 class="sidebar-title">Export Settings</h2>
      <button class="sidebar-close" @click="$emit('close')" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
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
            class="bg-swatch"
            :class="{ active: state.background.value === bg.value, 'swatch-transparent': bg.value === 'transparent' }"
            :style="bg.value === 'transparent' ? {} : { backgroundColor: bg.color }"
            :title="bg.label"
            @click="state.selectBackground(bg.value)"
          ></button>
          <div class="custom-color-wrap">
            <label class="custom-color-label" title="Custom color">
              <input type="color" v-model="state.customBgColor.value" @input="state.selectBackground('custom')" class="custom-color-input"/>
              <span class="custom-color-swatch" :style="{ backgroundColor: state.customBgColor.value }">
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M6 2v8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
              </span>
            </label>
          </div>
        </div>
      </section>

      <!-- Context-sensitive: Note properties (when note is selected) -->
      <section v-if="state.selectedAnnotation.value === 'note'" class="settings-section annotation-props">
        <h3 class="section-heading">Note Properties</h3>
        <div class="field-row">
          <label class="field-label">Text</label>
          <input type="text" v-model="state.note.text" class="field-input" placeholder="Note text..."/>
        </div>
        <div v-if="!state.notePoint.value" class="field-row">
          <label class="field-label">Preset</label>
          <select v-model="state.note.position" class="field-select">
            <option value="top-left">Top Left</option>
            <option value="top-center">Top Center</option>
            <option value="top-right">Top Right</option>
            <option value="bottom-left">Bottom Left</option>
            <option value="bottom-center">Bottom Center</option>
            <option value="bottom-right">Bottom Right</option>
          </select>
        </div>
        <div class="field-row">
          <label class="field-label">Font Size <span class="field-value">{{ state.note.fontSize }}px</span></label>
          <input type="range" v-model.number="state.note.fontSize" min="10" max="24" class="field-range" :style="rangeTrackStyle(state.note.fontSize, 10, 24)"/>
        </div>
        <div class="field-row">
          <label class="field-label">Color</label>
          <input type="color" v-model="state.note.color" class="field-color"/>
        </div>
        <div class="field-row annotation-delete-row">
          <button class="btn-delete-annotation" @click="state.removeAnnotation('note')">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4.5 3V2h3v1M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Remove Note
          </button>
        </div>
      </section>

      <!-- Context-sensitive: Arrow properties (when arrow is selected) -->
      <section v-if="state.selectedAnnotation.value === 'arrow'" class="settings-section annotation-props">
        <h3 class="section-heading">Arrow Properties</h3>
        <div class="field-row">
          <label class="field-label">Type</label>
          <select v-model="state.arrow.type" class="field-select">
            <option value="→">→ Single (right)</option>
            <option value="←">← Single (left)</option>
            <option value="←→">←→ Double</option>
            <option value="⤷">⤷ Curved</option>
          </select>
        </div>
        <div class="field-row">
          <label class="field-label">Label</label>
          <input type="text" v-model="state.arrow.label" class="field-input" placeholder="Optional label..."/>
        </div>
        <div class="field-row">
          <label class="field-label">Color</label>
          <input type="color" v-model="state.arrow.color" class="field-color"/>
        </div>
        <div class="field-row">
          <label class="field-label">Thickness <span class="field-value">{{ state.arrow.thickness }}px</span></label>
          <input type="range" v-model.number="state.arrow.thickness" min="1" max="6" class="field-range" :style="rangeTrackStyle(state.arrow.thickness, 1, 6)"/>
        </div>
        <div class="field-row annotation-delete-row">
          <button class="btn-delete-annotation" @click="state.removeAnnotation('arrow')">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4.5 3V2h3v1M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Remove Arrow
          </button>
        </div>
      </section>

      <!-- Context-sensitive: Callout properties (when callout is selected) -->
      <section v-if="state.selectedAnnotation.value === 'callout'" class="settings-section annotation-props">
        <h3 class="section-heading">Callout Properties</h3>
        <div class="field-row">
          <label class="field-label">Text</label>
          <input type="text" v-model="state.callout.text" class="field-input" placeholder="Label text..."/>
        </div>
        <div class="field-row">
          <label class="field-label">Font Size <span class="field-value">{{ state.callout.fontSize }}px</span></label>
          <input type="range" v-model.number="state.callout.fontSize" min="10" max="24" class="field-range" :style="rangeTrackStyle(state.callout.fontSize, 10, 24)"/>
        </div>
        <div class="field-row">
          <label class="field-label">Text Color</label>
          <input type="color" v-model="state.callout.color" class="field-color"/>
        </div>
        <div class="field-row">
          <label class="field-label">Background</label>
          <input type="color" v-model="state.callout.bgColor" class="field-color"/>
        </div>
        <div class="field-row annotation-delete-row">
          <button class="btn-delete-annotation" @click="state.removeAnnotation('callout')">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4.5 3V2h3v1M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Remove Callout
          </button>
        </div>
      </section>

      <!-- Context-sensitive: Watermark properties (when watermark is selected) -->
      <section v-if="state.selectedAnnotation.value === 'watermark'" class="settings-section annotation-props">
        <h3 class="section-heading">Watermark Properties</h3>
        <div class="field-row">
          <label class="field-label">Text</label>
          <input type="text" v-model="state.watermark.text" class="field-input" placeholder="Confidential"/>
        </div>
        <div class="field-row">
          <label class="field-label">Opacity <span class="field-value">{{ state.watermark.opacity }}%</span></label>
          <input type="range" v-model.number="state.watermark.opacity" min="5" max="50" class="field-range" :style="rangeTrackStyle(state.watermark.opacity, 5, 50)"/>
        </div>
        <div class="field-row">
          <label class="field-label">Font Size <span class="field-value">{{ state.watermark.fontSize }}px</span></label>
          <input type="range" v-model.number="state.watermark.fontSize" min="12" max="48" class="field-range" :style="rangeTrackStyle(state.watermark.fontSize, 12, 48)"/>
        </div>
        <div class="field-row">
          <label class="field-label">Color</label>
          <input type="color" v-model="state.watermark.color" class="field-color"/>
        </div>
        <div class="field-row">
          <label class="field-label">Position</label>
          <select v-model="state.watermark.position" class="field-select">
            <option value="diagonal">Diagonal</option>
            <option value="bottom-right">Bottom Right</option>
          </select>
        </div>
        <div class="field-row annotation-delete-row">
          <button class="btn-delete-annotation" @click="state.removeAnnotation('watermark')">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3h8M4.5 3V2h3v1M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
            Remove Watermark
          </button>
        </div>
      </section>

      <!-- Hint when no annotation selected -->
      <section v-if="!state.selectedAnnotation.value" class="settings-section annotation-hint-section">
        <div class="annotation-hint">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" opacity="0.5"><circle cx="8" cy="8" r="6.5" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3M8 10v.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          <span>Use the toolbar above to add annotations. Select an annotation to edit its properties.</span>
        </div>
      </section>
    </div>

    <!-- Action bar -->
    <div class="sidebar-actions">
      <button class="btn-cancel" @click="$emit('close')">Cancel</button>
      <button class="btn-export" @click="$emit('export')" :disabled="state.isExporting.value">
        <svg v-if="state.isExporting.value" class="spin" width="13" height="13" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
          <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
        <svg v-else width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v8M3 6.5l3.5 3.5 3.5-3.5M1.5 11.5h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
        {{ state.isExporting.value ? 'Exporting…' : 'Download PNG' }}
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { exportStateKey } from './useExportState';

export default defineComponent({
  name: 'ExportSidebar',

  inject: {
    state: {
      from: exportStateKey,
      default: () => {
        throw new Error('[ExportSidebar] Missing export state injection');
      },
    },
  },

  emits: ['close', 'export'],

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
  color: #64748b;
  line-height: 1.5;
  font-family: 'Outfit', sans-serif;
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
  font-family: 'Outfit', sans-serif;
  color: #94a3b8;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.btn-delete-annotation:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}
</style>
