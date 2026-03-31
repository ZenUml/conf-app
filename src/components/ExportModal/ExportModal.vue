<template>
  <Transition name="modal">
    <div v-if="visible" class="export-modal-backdrop" @click.self="$emit('close')">
      <div class="export-modal">
        <!-- Left: Preview (60%) -->
        <div class="export-preview-pane">
          <div class="preview-header">
            <span class="preview-label">Preview</span>
            <button class="preview-refresh" @click="capturePreview" :disabled="isCapturing" title="Refresh preview">
              <svg :class="{ 'spin': isCapturing }" width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M12.5 7A5.5 5.5 0 1 1 7 1.5M12.5 1.5v4h-4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              <span>{{ isCapturing ? 'Capturing…' : 'Refresh' }}</span>
            </button>
          </div>
          <div class="preview-stage">
            <div class="preview-canvas-wrap" :style="previewCanvasStyle">
              <div class="preview-canvas"
                   @click="handlePreviewClick"
                   :class="{ 'arrow-cursor': (arrow.enabled && arrowClickCount < 2) || notePlaceMode }">
              <!-- Diagram placeholder -->
              <div class="preview-diagram-placeholder">
                <div v-if="isCapturing" class="preview-loading">
                  <svg class="spin" width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="#334155" stroke-width="2"/>
                    <path d="M12 2a10 10 0 0 1 10 10" stroke="#3b82f6" stroke-width="2" stroke-linecap="round"/>
                  </svg>
                </div>
                <img v-else-if="previewDataUrl" :src="previewDataUrl" class="preview-real-diagram" alt="Diagram preview" />
                <span v-else class="preview-diagram-label">No preview available</span>
              </div>

              <!-- Arrow overlay -->
              <svg v-if="arrow.enabled && arrowPoints" class="preview-arrow-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <marker id="arrowhead-end" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" :fill="arrow.color"/>
                  </marker>
                  <marker id="arrowhead-start" markerWidth="10" markerHeight="7" refX="1" refY="3.5" orient="auto-start-reverse">
                    <polygon points="0 0, 10 3.5, 0 7" :fill="arrow.color"/>
                  </marker>
                </defs>
                <!-- Start point dot — visible only when waiting for end point -->
                <circle
                  v-if="arrowClickCount === 1"
                  :cx="arrowPoints.start.x"
                  :cy="arrowPoints.start.y"
                  r="0.015"
                  :fill="arrow.color"
                  vector-effect="non-scaling-stroke"
                />
                <line
                  v-if="arrowClickCount === 2"
                  :x1="arrowPoints.start.x" :y1="arrowPoints.start.y"
                  :x2="arrowPoints.end.x" :y2="arrowPoints.end.y"
                  :stroke="arrow.color"
                  :stroke-width="arrow.thickness * 0.003"
                  vector-effect="non-scaling-stroke"
                  :marker-end="(arrow.type === '→' || arrow.type === '←→' || arrow.type === '⤷') ? 'url(#arrowhead-end)' : null"
                  :marker-start="(arrow.type === '←' || arrow.type === '←→') ? 'url(#arrowhead-start)' : null"
                />
              </svg>
              <div v-if="notePlaceMode" class="arrow-click-hint">Click to place note</div>
              <div v-else-if="arrow.enabled && arrowClickCount < 2" class="arrow-click-hint">
                {{ arrowClickCount === 0 ? 'Click to set arrow start' : 'Click to set arrow end' }}
              </div>
              <div v-else-if="arrow.enabled && arrowClickCount === 2" class="arrow-click-hint arrow-click-hint--reset">
                Click again to reset arrow
              </div>

              <!-- Note overlay -->
              <div v-if="note.text" class="preview-note" :style="noteStyle">
                {{ note.text }}
              </div>

              <!-- Watermark overlay -->
              <div v-if="watermark.enabled && watermark.text" class="preview-watermark" :style="watermarkStyle">
                {{ watermark.text }}
              </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Vertical divider -->
        <div class="export-divider"></div>

        <!-- Right: Settings (40%, dark sidebar) -->
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
                  v-for="t in themes"
                  :key="t.value"
                  class="theme-card"
                  :class="{ active: theme === t.value }"
                  @click="theme = t.value"
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
                  v-for="bg in backgrounds"
                  :key="bg.value"
                  class="bg-swatch"
                  :class="{ active: background === bg.value, 'swatch-transparent': bg.value === 'transparent' }"
                  :style="bg.value === 'transparent' ? {} : { backgroundColor: bg.color }"
                  :title="bg.label"
                  @click="selectBackground(bg.value)"
                ></button>
                <div class="custom-color-wrap">
                  <label class="custom-color-label" title="Custom color">
                    <input type="color" v-model="customBgColor" @input="selectBackground('custom')" class="custom-color-input"/>
                    <span class="custom-color-swatch" :style="{ backgroundColor: customBgColor }">
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
                <input type="text" v-model="note.text" class="field-input" placeholder="Add a caption..."/>
              </div>
              <div class="field-row">
                <label class="field-label">Position</label>
                <div class="note-position-controls">
                  <button
                    class="btn-place-note"
                    :class="{ active: notePlaceMode }"
                    @click="notePlaceMode = !notePlaceMode; if (notePlaceMode) notePoint = null"
                    :title="notePoint ? 'Click to reposition' : 'Click on preview to place'"
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style="flex-shrink:0"><circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.5"/><circle cx="5.5" cy="5.5" r="1.5" fill="currentColor"/></svg>
                    {{ notePoint ? 'Reposition' : 'Click to place' }}
                  </button>
                  <button v-if="notePoint" class="btn-clear-note" @click="notePoint = null; notePlaceMode = false" title="Clear custom position">✕</button>
                </div>
              </div>
              <div v-if="!notePoint" class="field-row">
                <label class="field-label">Preset</label>
                <select v-model="note.position" class="field-select">
                  <option value="top-left">Top Left</option>
                  <option value="top-center">Top Center</option>
                  <option value="top-right">Top Right</option>
                  <option value="bottom-left">Bottom Left</option>
                  <option value="bottom-center">Bottom Center</option>
                  <option value="bottom-right">Bottom Right</option>
                </select>
              </div>
              <div class="field-row">
                <label class="field-label">Font Size <span class="field-value">{{ note.fontSize }}px</span></label>
                <input type="range" v-model.number="note.fontSize" min="10" max="24" class="field-range" :style="rangeTrackStyle(note.fontSize, 10, 24)"/>
              </div>
              <div class="field-row">
                <label class="field-label">Color</label>
                <input type="color" v-model="note.color" class="field-color"/>
              </div>
            </section>

            <!-- Arrow Section -->
            <section class="settings-section">
              <h3 class="section-heading">Arrow</h3>
              <div class="field-row">
                <label class="field-label">Enabled</label>
                <button class="toggle" :class="{ on: arrow.enabled }" @click="arrow.enabled = !arrow.enabled">
                  <span class="toggle-thumb"></span>
                </button>
              </div>
              <template v-if="arrow.enabled">
                <div class="field-row">
                  <label class="field-label">Type</label>
                  <select v-model="arrow.type" class="field-select">
                    <option value="→">→ Single (right)</option>
                    <option value="←">← Single (left)</option>
                    <option value="←→">←→ Double</option>
                    <option value="⤷">⤷ Curved</option>
                  </select>
                </div>
                <div class="field-row">
                  <label class="field-label">Label</label>
                  <input type="text" v-model="arrow.label" class="field-input" placeholder="Optional label..."/>
                </div>
                <div class="field-row">
                  <label class="field-label">Color</label>
                  <input type="color" v-model="arrow.color" class="field-color"/>
                </div>
                <div class="field-row">
                  <label class="field-label">Thickness <span class="field-value">{{ arrow.thickness }}px</span></label>
                  <input type="range" v-model.number="arrow.thickness" min="1" max="6" class="field-range" :style="rangeTrackStyle(arrow.thickness, 1, 6)"/>
                </div>
              </template>
            </section>

            <!-- Watermark Section -->
            <section class="settings-section">
              <h3 class="section-heading">Watermark</h3>
              <div class="field-row">
                <label class="field-label">Enabled</label>
                <button class="toggle" :class="{ on: watermark.enabled }" @click="watermark.enabled = !watermark.enabled">
                  <span class="toggle-thumb"></span>
                </button>
              </div>
              <template v-if="watermark.enabled">
                <div class="field-row">
                  <label class="field-label">Text</label>
                  <input type="text" v-model="watermark.text" class="field-input" placeholder="Confidential"/>
                </div>
                <div class="field-row">
                  <label class="field-label">Opacity <span class="field-value">{{ watermark.opacity }}%</span></label>
                  <input type="range" v-model.number="watermark.opacity" min="5" max="50" class="field-range" :style="rangeTrackStyle(watermark.opacity, 5, 50)"/>
                </div>
                <div class="field-row">
                  <label class="field-label">Font Size <span class="field-value">{{ watermark.fontSize }}px</span></label>
                  <input type="range" v-model.number="watermark.fontSize" min="12" max="48" class="field-range" :style="rangeTrackStyle(watermark.fontSize, 12, 48)"/>
                </div>
                <div class="field-row">
                  <label class="field-label">Color</label>
                  <input type="color" v-model="watermark.color" class="field-color"/>
                </div>
                <div class="field-row">
                  <label class="field-label">Position</label>
                  <select v-model="watermark.position" class="field-select">
                    <option value="diagonal">Diagonal</option>
                    <option value="bottom-right">Bottom Right</option>
                  </select>
                </div>
              </template>
            </section>

          </div><!-- end sidebar-scroll -->

          <!-- Action bar -->
          <div class="sidebar-actions">
            <button class="btn-cancel" @click="$emit('close')">Cancel</button>
            <button class="btn-export" @click="handleExport" :disabled="isExporting">
              <svg v-if="isExporting" class="spin" width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="rgba(255,255,255,0.3)" stroke-width="2"/>
                <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              </svg>
              <svg v-else width="13" height="13" viewBox="0 0 13 13" fill="none"><path d="M6.5 1v8M3 6.5l3.5 3.5 3.5-3.5M1.5 11.5h10" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              {{ isExporting ? 'Exporting…' : 'Download PNG' }}
            </button>
          </div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<script lang="ts">
import { defineComponent } from 'vue';
import { useExportEngine } from './useExportEngine';

export default defineComponent({
  name: 'ExportModal',

  props: {
    visible: {
      type: Boolean,
      required: true,
    },
  },

  emits: ['close', 'export'],

  data() {
    return {
      theme: 'auto' as string,
      background: 'white' as string,
      customBgColor: '#ffffff',
      previewDataUrl: null as string | null,
      isCapturing: false,
      isExporting: false,
      arrowPoints: null as { start: { x: number; y: number }; end: { x: number; y: number } } | null,
      arrowClickCount: 0,
      notePoint: null as { x: number; y: number } | null,
      notePlaceMode: false,

      note: {
        text: '',
        position: 'bottom-center',
        fontSize: 14,
        color: '#374151',
      },

      arrow: {
        enabled: false,
        type: '→',
        label: '',
        color: '#ef4444',
        thickness: 2,
      },

      watermark: {
        enabled: false,
        text: 'Confidential',
        opacity: 20,
        fontSize: 24,
        color: '#9ca3af',
        position: 'diagonal',
      },

      themes: [
        {
          value: 'auto',
          label: 'Auto',
          style: { background: 'linear-gradient(135deg, #ffffff 50%, #1e293b 50%)', border: '1px solid #334155' },
        },
        {
          value: 'light',
          label: 'Light',
          style: { backgroundColor: '#ffffff', border: '1px solid #e2e8f0' },
        },
        {
          value: 'dark',
          label: 'Dark',
          style: { backgroundColor: '#1e293b', border: '1px solid #334155' },
        },
        {
          value: 'blueprint',
          label: 'Blueprint',
          style: { backgroundColor: '#0f172a', border: '1px solid #1e3a5f' },
        },
      ],

      backgrounds: [
        { value: 'transparent', label: 'Transparent', color: '' },
        { value: 'white', label: 'White', color: '#ffffff' },
        { value: 'warm', label: 'Warm', color: '#fffbf0' },
        { value: 'cool', label: 'Cool', color: '#f0f4ff' },
      ],
    };
  },

  computed: {
    resolvedBgColor(): string {
      if (this.background === 'transparent') return 'transparent';
      if (this.background === 'white') return '#ffffff';
      if (this.background === 'warm') return '#fffbf0';
      if (this.background === 'cool') return '#f0f4ff';
      if (this.background === 'custom') return this.customBgColor;
      return '#ffffff';
    },

    resolvedThemeBg(): string {
      if (this.theme === 'light') return '#ffffff';
      if (this.theme === 'dark') return '#1e293b';
      if (this.theme === 'blueprint') return '#0f172a';
      return '#f8fafc'; // auto
    },

    placeholderStroke(): string {
      if (this.theme === 'dark' || this.theme === 'blueprint') return '#e2e8f0';
      return '#64748b';
    },

    previewCanvasStyle(): Record<string, string> {
      const themeColors: Record<string, string> = {
        auto: '#f0f2f5',
        light: '#ffffff',
        dark: '#1e293b',
        blueprint: '#0f172a',
      };
      const themeBg = themeColors[this.theme] || '#f0f2f5';
      const style: Record<string, string> = { padding: '16px' };

      if (this.background === 'transparent') {
        style.backgroundImage = `
          linear-gradient(45deg, #ccc 25%, transparent 25%),
          linear-gradient(-45deg, #ccc 25%, transparent 25%),
          linear-gradient(45deg, transparent 75%, #ccc 75%),
          linear-gradient(-45deg, transparent 75%, #ccc 75%)
        `;
        style.backgroundSize = '16px 16px';
        style.backgroundPosition = '0 0, 0 8px, 8px -8px, -8px 0px';
      } else {
        // Any explicit background swatch overrides the theme; default (no swatch selected) shows theme
        const isDefaultBg = this.background === 'white' && (this.theme === 'light' || this.theme === 'auto');
        style.backgroundColor = isDefaultBg ? themeBg : this.resolvedBgColor;
      }

      return style;
    },

    diagramPlaceholderStyle(): Record<string, string> {
      return {};
    },

    noteStyle(): Record<string, string> {
      const style: Record<string, string> = {
        fontSize: `${this.note.fontSize}px`,
        color: this.note.color,
      };
      if (this.notePoint) {
        style.left = `${this.notePoint.x * 100}%`;
        style.top = `${this.notePoint.y * 100}%`;
        style.transform = 'translate(-50%, -50%)';
        style.textAlign = 'center';
      } else {
        const pos = this.note.position;
        if (pos.startsWith('top')) style.top = '12px';
        else style.bottom = '12px';
        if (pos.endsWith('left')) { style.left = '12px'; style.textAlign = 'left'; }
        else if (pos.endsWith('right')) { style.right = '12px'; style.textAlign = 'right'; }
        else { style.left = '50%'; style.transform = 'translateX(-50%)'; style.textAlign = 'center'; }
      }
      return style;
    },

    watermarkStyle(): Record<string, string> {
      const style: Record<string, string> = {
        color: this.watermark.color,
        fontSize: `${this.watermark.fontSize}px`,
        opacity: String(this.watermark.opacity / 100),
      };
      if (this.watermark.position === 'diagonal') {
        style.top = '50%';
        style.left = '50%';
        style.transform = 'translate(-50%, -50%) rotate(-45deg)';
        style.textAlign = 'center';
      } else {
        style.bottom = '16px';
        style.right = '16px';
        style.transform = 'none';
      }
      return style;
    },
  },

  watch: {
    async visible(val: boolean) {
      if (val) {
        await this.$nextTick();
        await (this as any).capturePreview();
      }
    },
    theme() {
      (this as any).scheduleCapturePreview();
    },
    background() {
      (this as any).scheduleCapturePreview();
    },
    'arrow.enabled'(val: boolean) {
      if (!val) {
        (this as any).arrowPoints = null;
        (this as any).arrowClickCount = 0;
      }
    },
  },

  methods: {
    rangeTrackStyle(value: number, min: number, max: number): Record<string, string> {
      const pct = ((value - min) / (max - min)) * 100;
      return {
        background: `linear-gradient(to right, #3b82f6 ${pct}%, #334155 ${pct}%)`
      };
    },

    selectBackground(value: string) {
      this.background = value;
    },

    scheduleCapturePreview() {
      const self = this as any;
      if (self._captureTimer) clearTimeout(self._captureTimer);
      self._captureTimer = setTimeout(() => self.capturePreview(), 300);
    },

    async capturePreview() {
      const node = document.querySelector('.screen-capture-content') as HTMLElement | null;
      if (!node) return;
      const self = this as any;
      const gen = (self._captureGen = (self._captureGen ?? 0) + 1);
      this.isCapturing = true;
      try {
        const { toPng } = await import('html-to-image');
        const themeColors: Record<string, string> = {
          auto: '#ffffff', light: '#ffffff', dark: '#1e293b', blueprint: '#0f172a',
        };
        const themeBg = themeColors[this.theme] ?? '#ffffff';
        const isDefaultBg = this.background === 'white' && (this.theme === 'light' || this.theme === 'auto');
        const bgColor = isDefaultBg ? themeBg : (this as any).resolvedBgColor;
        const dataUrl = await toPng(node, {
          skipFonts: true,
          backgroundColor: bgColor === 'transparent' ? undefined : bgColor,
        });
        if (self._captureGen === gen) {
          this.previewDataUrl = dataUrl;
        }
      } catch (e) {
        console.warn('[ExportModal] preview capture failed:', e);
      } finally {
        if ((self._captureGen ?? 0) === gen) {
          this.isCapturing = false;
        }
      }
    },

    handlePreviewClick(event: MouseEvent) {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width;
      const y = (event.clientY - rect.top) / rect.height;

      if (this.notePlaceMode) {
        this.notePoint = { x, y };
        this.notePlaceMode = false;
        return;
      }

      if (!this.arrow.enabled) return;
      if (this.arrowClickCount === 0) {
        this.arrowPoints = { start: { x, y }, end: { x, y } };
        this.arrowClickCount = 1;
      } else if (this.arrowClickCount === 1) {
        this.arrowPoints = { start: this.arrowPoints!.start, end: { x, y } };
        this.arrowClickCount = 2;
      } else {
        this.arrowPoints = null;
        this.arrowClickCount = 0;
      }
    },

    async handleExport() {
      if ((this as any).isExporting) return;
      this.isExporting = true;
      try {
        const options = {
          theme: this.theme,
          background: this.background === 'custom' ? this.customBgColor : this.background,
          note: { ...this.note },
          arrow: { ...this.arrow },
          watermark: { ...this.watermark },
          arrowPoints: this.arrowPoints,
          notePoint: this.notePoint,
        };
        const { exportDiagram } = useExportEngine();
        await exportDiagram(options);
        this.$emit('close');
      } finally {
        this.isExporting = false;
      }
    },
  },
});
</script>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

/* ─── CSS Variables ─── */
.export-modal-backdrop,
.export-modal,
.export-sidebar,
.export-preview-pane {
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
.preview-refresh:hover:not(:disabled) {
  border-color: #3b82f6;
  color: #3b82f6;
}
.preview-refresh:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
.spin {
  animation: spin 0.9s linear infinite;
}

.preview-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: #94a3b8;
  display: flex;
  align-items: center;
  gap: 7px;
}
.preview-label::before {
  content: '';
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #22d3ee;
  animation: livepulse 2s ease-in-out infinite;
}
@keyframes livepulse {
  0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 211, 238, 0.4); }
  50% { opacity: 0.5; box-shadow: 0 0 0 4px rgba(34, 211, 238, 0); }
}

.preview-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  overflow: auto;
  background-image: radial-gradient(circle, #b6c4d4 1px, transparent 1px);
  background-size: 20px 20px;
  background-position: 0 0;
}

/* Outer wrap controls background color / checkerboard */
.preview-canvas-wrap {
  border-radius: 10px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0,0,0,0.08);
  max-width: 100%;
  max-height: 100%;
}

/* Inner canvas sizes to diagram content */
.preview-canvas {
  position: relative;
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 120px;
}

.preview-diagram-placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.preview-diagram-label {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  letter-spacing: 0.05em;
  color: #94a3b8;
}

.preview-real-diagram {
  display: block;
  max-width: 100%;
  height: auto;
}

.preview-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px;
}

.arrow-cursor {
  cursor: crosshair;
}

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

.arrow-click-hint--reset {
  background: rgba(100, 116, 139, 0.85);
}

/* Arrow SVG overlay */
.preview-arrow-overlay {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

/* Note overlay */
.preview-note {
  position: absolute;
  font-family: 'Outfit', sans-serif;
  font-weight: 500;
  line-height: 1.4;
  pointer-events: none;
  white-space: nowrap;
  max-width: 80%;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Watermark overlay */
.preview-watermark {
  position: absolute;
  font-family: 'JetBrains Mono', monospace;
  font-weight: 500;
  letter-spacing: 0.08em;
  pointer-events: none;
  white-space: nowrap;
  user-select: none;
}

/* ─── Vertical divider ─── */
.export-divider {
  width: 1px;
  background: var(--sidebar-border);
  flex-shrink: 0;
}

/* ─── Sidebar (right 40%) ─── */
.export-sidebar {
  flex: 0 0 40%;
  background: var(--sidebar-bg);
  color: var(--sidebar-text);
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 20px 14px;
  border-bottom: 1px solid var(--sidebar-border);
  flex-shrink: 0;
}

.sidebar-title {
  font-family: 'Outfit', sans-serif;
  font-size: 16px;
  font-weight: 700;
  color: #f1f5f9;
  margin: 0;
  letter-spacing: -0.01em;
}

.sidebar-close {
  background: none;
  border: none;
  color: var(--sidebar-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  display: flex;
  align-items: center;
  transition: color 0.15s, background 0.15s;
}
.sidebar-close:hover {
  color: var(--sidebar-text);
  background: var(--sidebar-hover);
}

/* ─── Scrollable settings area ─── */
.sidebar-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0 16px;
  scrollbar-width: thin;
  scrollbar-color: #334155 transparent;
}
.sidebar-scroll::-webkit-scrollbar { width: 4px; }
.sidebar-scroll::-webkit-scrollbar-track { background: transparent; }
.sidebar-scroll::-webkit-scrollbar-thumb { background: #334155; border-radius: 4px; }
.sidebar-scroll::-webkit-scrollbar-thumb:hover { background: #475569; }

/* ─── Settings sections ─── */
.settings-section {
  padding: 16px 20px;
  border-bottom: 1px solid var(--sidebar-border);
}
.settings-section:last-child {
  border-bottom: none;
}

.section-heading {
  font-family: 'JetBrains Mono', monospace;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #94a3b8;
  margin: 0 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.section-heading::before {
  content: '';
  display: inline-block;
  width: 3px;
  height: 10px;
  background: var(--accent);
  border-radius: 2px;
  flex-shrink: 0;
  opacity: 1;
}

/* ─── Theme cards ─── */
.theme-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.theme-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: none;
  border: 1px solid var(--sidebar-border);
  border-radius: 8px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  color: var(--sidebar-text);
}
.theme-card:hover {
  background: var(--sidebar-hover);
  border-color: #334155;
}
.theme-card.active {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
  background: rgba(59, 130, 246, 0.08);
}

.theme-swatch {
  width: 100%;
  height: 40px;
  border-radius: 5px;
  position: relative;
  overflow: hidden;
}

.theme-swatch::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image: repeating-linear-gradient(
    to bottom,
    transparent 0px,
    transparent 6px,
    rgba(128, 128, 128, 0.12) 6px,
    rgba(128, 128, 128, 0.12) 7px
  );
  border-radius: inherit;
  pointer-events: none;
}

.theme-label {
  font-family: 'Outfit', sans-serif;
  font-size: 11px;
  font-weight: 600;
  color: var(--sidebar-muted);
  letter-spacing: 0.02em;
}
.theme-card.active .theme-label {
  color: #93c5fd;
}

/* ─── Background swatches ─── */
.bg-swatches {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.bg-swatch {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid #334155;
  cursor: pointer;
  transition: transform 0.1s, box-shadow 0.1s;
  flex-shrink: 0;
}
.bg-swatch:hover {
  transform: scale(1.1);
}
.bg-swatch.active {
  box-shadow: 0 0 0 2px var(--accent);
  border-color: var(--accent);
  transform: scale(1.05);
}
.swatch-transparent {
  background-image:
    linear-gradient(45deg, #94a3b8 25%, transparent 25%),
    linear-gradient(-45deg, #94a3b8 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #94a3b8 75%),
    linear-gradient(-45deg, transparent 75%, #94a3b8 75%);
  background-size: 8px 8px;
  background-position: 0 0, 0 4px, 4px -4px, -4px 0;
  background-color: #e2e8f0;
}

.custom-color-wrap {
  position: relative;
}
.custom-color-label {
  cursor: pointer;
}
.custom-color-input {
  position: absolute;
  width: 0;
  height: 0;
  opacity: 0;
  pointer-events: none;
}
.custom-color-swatch {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px dashed #475569;
  cursor: pointer;
  color: #64748b;
  transition: border-color 0.15s;
}
.custom-color-swatch:hover {
  border-color: var(--accent);
  color: var(--accent);
}
.custom-color-label:focus-within .custom-color-swatch {
  box-shadow: 0 0 0 2px var(--accent);
}

/* ─── Field rows ─── */
.field-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}
.field-row:last-child {
  margin-bottom: 0;
}

.field-label {
  font-family: 'Outfit', sans-serif;
  font-size: 12px;
  font-weight: 500;
  color: var(--sidebar-muted);
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
}

.field-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #cbd5e1;
  font-weight: 600;
}

.field-input {
  flex: 1;
  min-width: 0;
  background: var(--sidebar-border);
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 6px 10px;
  font-family: 'Outfit', sans-serif;
  font-size: 12px;
  color: var(--sidebar-text);
  outline: none;
  transition: border-color 0.15s;
}
.field-input::placeholder {
  color: #475569;
}
.field-input:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
}

.field-select {
  flex: 1;
  min-width: 0;
  background: var(--sidebar-border);
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 6px 10px;
  font-family: 'Outfit', sans-serif;
  font-size: 12px;
  color: var(--sidebar-text);
  outline: none;
  appearance: none;
  cursor: pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8' fill='none'%3E%3Cpath d='M1 1L6 7L11 1' stroke='%2364748b' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
  transition: border-color 0.15s;
}
.field-select:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.2);
}
.field-select option {
  background: #1e293b;
  color: var(--sidebar-text);
}

.field-range {
  flex: 1;
  min-width: 0;
  -webkit-appearance: none;
  appearance: none;
  cursor: pointer;
  height: 4px;
  border-radius: 2px;
  background: #334155;
  outline: none;
}
.field-range::-webkit-slider-thumb {
  -webkit-appearance: none;
  appearance: none;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #3b82f6;
  border: 2px solid #0f172a;
  cursor: pointer;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
  transition: box-shadow 0.15s, transform 0.1s;
}
.field-range::-webkit-slider-thumb:hover {
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.25);
  transform: scale(1.15);
}
.field-range::-moz-range-thumb {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #3b82f6;
  border: 2px solid #0f172a;
  cursor: pointer;
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.3);
}

.field-color {
  width: 32px;
  height: 28px;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 2px;
  background: var(--sidebar-border);
  cursor: pointer;
  outline: none;
}
.field-color:focus {
  box-shadow: 0 0 0 2px var(--accent);
}

/* ─── Toggle ─── */
.toggle {
  position: relative;
  width: 36px;
  height: 20px;
  border-radius: 10px;
  background: #334155;
  border: none;
  cursor: pointer;
  transition: background 0.2s;
  flex-shrink: 0;
  padding: 0;
}
.toggle.on {
  background: var(--accent);
}
.toggle:hover {
  background: #475569;
}
.toggle.on:hover {
  background: #1d4ed8;
}
.toggle:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}
.toggle-thumb {
  position: absolute;
  top: 3px;
  left: 3px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: #ffffff;
  transition: transform 0.2s;
  pointer-events: none;
}
.toggle.on .toggle-thumb {
  transform: translateX(16px);
}

/* ─── Action bar ─── */
.sidebar-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 20px;
  background: var(--sidebar-bg);
  box-shadow: 0 -1px 0 #1e293b, 0 -8px 16px rgba(15, 23, 42, 0.6);
  flex-shrink: 0;
  gap: 10px;
}

.btn-cancel {
  background: none;
  border: 1px solid #334155;
  border-radius: 8px;
  padding: 8px 18px;
  font-family: 'Outfit', sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: var(--sidebar-muted);
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s;
}
.btn-cancel:hover {
  border-color: #475569;
  color: var(--sidebar-text);
}

.note-position-controls {
  display: flex;
  gap: 6px;
  align-items: center;
  flex: 1;
}
.btn-place-note {
  flex: 1;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
  font-family: 'Outfit', sans-serif;
  color: #94a3b8;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
  display: flex;
  align-items: center;
  gap: 6px;
}
.btn-place-note:hover {
  border-color: var(--accent);
  color: #ffffff;
}
.btn-place-note.active {
  border-color: var(--accent);
  color: #ffffff;
  background: rgba(59, 130, 246, 0.15);
  box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.4);
  animation: pulse-ring 1.5s ease-in-out infinite;
}
@keyframes pulse-ring {
  0%, 100% { box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.4); }
  50% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.15); }
}
.btn-clear-note {
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 6px;
  padding: 5px 8px;
  font-size: 12px;
  color: #94a3b8;
  cursor: pointer;
  line-height: 1;
}
.btn-clear-note:hover {
  border-color: #ef4444;
  color: #ef4444;
}

.btn-export {
  background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
  border: none;
  border-radius: 8px;
  padding: 9px 22px;
  font-family: 'Outfit', sans-serif;
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
  cursor: pointer;
  transition: box-shadow 0.2s, transform 0.15s;
  letter-spacing: 0.03em;
  display: flex;
  align-items: center;
  gap: 7px;
  box-shadow: 0 2px 12px rgba(59, 130, 246, 0.35);
}
.btn-export:hover {
  box-shadow: 0 4px 20px rgba(59, 130, 246, 0.55);
  transform: translateY(-1px);
}
.btn-export:active {
  transform: translateY(1px);
  box-shadow: 0 1px 6px rgba(59, 130, 246, 0.3);
}
.btn-export:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
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

/* ─── Reduced motion ─── */
@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
  .preview-label::before { animation: none; opacity: 0.8; }
  .btn-place-note.active { animation: none; }
  .modal-enter-active,
  .modal-leave-active,
  .modal-enter-active .export-modal,
  .modal-leave-active .export-modal {
    transition-duration: 0.01ms !important;
  }
}
</style>
