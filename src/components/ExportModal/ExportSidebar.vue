<template>
  <div class="export-sidebar">
    <div class="sidebar-header">
      <h2 class="sidebar-title">Export Settings</h2>
      <button class="sidebar-close" @click="$emit('close')" aria-label="Close">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 3L13 13M13 3L3 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
      </button>
    </div>

    <div class="sidebar-scroll">
      <!-- Theme Section -->
      <section class="settings-section">
        <h3 class="section-heading">Theme</h3>
        <div class="theme-grid">
          <button
            v-for="t in state.themes"
            :key="t.value"
            class="theme-card"
            :class="{ active: state.theme.value === t.value }"
            @click="state.theme.value = t.value"
          >
            <div class="theme-swatch" :style="t.style"></div>
            <span class="theme-label">{{ t.label }}</span>
          </button>
        </div>
      </section>

      <!-- Background Section -->
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

      <!-- Note Section -->
      <section class="settings-section">
        <h3 class="section-heading">Note</h3>
        <div class="field-row">
          <label class="field-label">Text</label>
          <input type="text" v-model="state.note.text" class="field-input" placeholder="Add a caption..."/>
        </div>
        <div class="field-row">
          <label class="field-label">Position</label>
          <div class="note-position-controls">
            <button
              class="btn-place-note"
              :class="{ active: state.notePlaceMode.value }"
              @click="toggleNotePlaceMode"
              :title="state.notePoint.value ? 'Click to reposition' : 'Click on preview to place'"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style="flex-shrink:0"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="5.5" r="1.5" fill="currentColor"/></svg>
              {{ state.notePoint.value ? 'Reposition' : 'Click to place' }}
            </button>
            <button v-if="state.notePoint.value" class="btn-clear-note" @click="clearNotePoint" title="Clear custom position">✕</button>
          </div>
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
      </section>

      <!-- Callout Section -->
      <section class="settings-section">
        <h3 class="section-heading">Callout</h3>
        <div class="field-row">
          <label class="field-label">Enabled</label>
          <button class="toggle" :class="{ on: state.callout.enabled }" @click="state.callout.enabled = !state.callout.enabled">
            <span class="toggle-thumb"></span>
          </button>
        </div>
        <template v-if="state.callout.enabled">
          <div class="field-row">
            <label class="field-label">Text</label>
            <input type="text" v-model="state.callout.text" class="field-input" placeholder="Label text..."/>
          </div>
          <div class="field-row">
            <label class="field-label">Position</label>
            <button
              class="btn-place-note"
              :class="{ active: state.calloutPlaceMode.value }"
              @click="toggleCalloutPlaceMode"
              :title="state.callout.position ? 'Click to reposition' : 'Click on preview to place'"
            >
              <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style="flex-shrink:0"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="5.5" r="1.5" fill="currentColor"/></svg>
              {{ state.callout.position ? 'Reposition' : 'Click to place' }}
            </button>
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
        </template>
      </section>

      <!-- Arrow Section -->
      <section class="settings-section">
        <h3 class="section-heading">Arrow</h3>
        <div class="field-row">
          <label class="field-label">Enabled</label>
          <button class="toggle" :class="{ on: state.arrow.enabled }" @click="toggleArrow">
            <span class="toggle-thumb"></span>
          </button>
        </div>
        <template v-if="state.arrow.enabled">
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
        </template>
      </section>

      <!-- Watermark Section -->
      <section class="settings-section">
        <h3 class="section-heading">Watermark</h3>
        <div class="field-row">
          <label class="field-label">Enabled</label>
          <button class="toggle" :class="{ on: state.watermark.enabled }" @click="state.watermark.enabled = !state.watermark.enabled">
            <span class="toggle-thumb"></span>
          </button>
        </div>
        <template v-if="state.watermark.enabled">
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
        </template>
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
import { defineComponent, type PropType } from 'vue';
import type { ExportState } from './useExportState';

export default defineComponent({
  name: 'ExportSidebar',

  props: {
    state: {
      type: Object as PropType<ExportState>,
      required: true,
    },
  },

  emits: ['close', 'export'],

  methods: {
    toggleCalloutPlaceMode() {
      this.state.calloutPlaceMode.value = !this.state.calloutPlaceMode.value;
      if (this.state.calloutPlaceMode.value) {
        this.state.callout.position = null;
        this.state.callout.tipPosition = null;
      }
    },
    rangeTrackStyle(value: number, min: number, max: number): Record<string, string> {
      const pct = ((value - min) / (max - min)) * 100;
      return { background: `linear-gradient(to right, #3b82f6 ${pct}%, #334155 ${pct}%)` };
    },

    toggleNotePlaceMode() {
      this.state.notePlaceMode.value = !this.state.notePlaceMode.value;
      if (this.state.notePlaceMode.value) {
        this.state.notePoint.value = null;
      }
    },

    clearNotePoint() {
      this.state.notePoint.value = null;
      this.state.notePlaceMode.value = false;
    },

    toggleArrow() {
      this.state.arrow.enabled = !this.state.arrow.enabled;
      if (!this.state.arrow.enabled) {
        this.state.resetArrow();
      }
    },
  },
});
</script>
