<template>
  <div
    v-if="visible"
    class="view-source-panel"
    role="dialog"
    aria-modal="true"
    aria-labelledby="view-source-panel-title"
    data-testid="view-source-panel"
  >
    <header class="view-source-header">
      <h2 id="view-source-panel-title" class="view-source-title">
        Diagram source · {{ dslLabel }}
      </h2>
      <button
        type="button"
        class="view-source-close"
        aria-label="Close source panel"
        data-testid="view-source-close"
        @click="$emit('close')"
      >
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="view-source-icon" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" />
        </svg>
      </button>
    </header>

    <pre class="view-source-code" data-testid="view-source-code" tabindex="0">{{ source }}</pre>

    <footer class="view-source-footer">
      <span class="view-source-meta" data-testid="view-source-meta">
        {{ lineCount }} {{ lineCount === 1 ? 'line' : 'lines' }} · read-only
      </span>
      <button
        type="button"
        class="view-source-copy"
        data-testid="view-source-copy"
        :aria-label="copied ? 'Copied' : 'Copy source'"
        @click="onCopy"
      >
        {{ copied ? 'Copied' : 'Copy' }}
      </button>
    </footer>
  </div>
</template>

<script>
export default {
  name: 'ViewSourcePanel',
  props: {
    visible: { type: Boolean, default: false },
    source: { type: String, default: '' },
    // Display label in the header: "ZenUML" | "Mermaid" | "PlantUML"
    dslLabel: { type: String, default: 'ZenUML' },
  },
  emits: ['close', 'copy'],
  data() {
    return {
      copied: false,
      _copiedTimer: null,
    };
  },
  computed: {
    lineCount() {
      if (!this.source) return 0;
      // Trailing newline does not add an extra empty line for the caption.
      const normalized = this.source.replace(/\n$/, '');
      if (normalized === '') return 0;
      return normalized.split('\n').length;
    },
  },
  watch: {
    visible(open) {
      if (!open) {
        this.copied = false;
        if (this._copiedTimer) {
          clearTimeout(this._copiedTimer);
          this._copiedTimer = null;
        }
      }
    },
  },
  beforeUnmount() {
    if (this._copiedTimer) {
      clearTimeout(this._copiedTimer);
      this._copiedTimer = null;
    }
  },
  methods: {
    async onCopy() {
      const text = this.source ?? '';
      let ok = false;
      if (navigator.clipboard && window.isSecureContext) {
        try {
          await navigator.clipboard.writeText(text);
          ok = true;
        } catch {
          /* fall through to legacy */
        }
      }
      if (!ok) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.top = '-9999px';
        textarea.setAttribute('readonly', '');
        document.body.appendChild(textarea);
        textarea.select();
        textarea.setSelectionRange(0, text.length);
        ok = document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      if (ok) {
        this.copied = true;
        if (this._copiedTimer) clearTimeout(this._copiedTimer);
        this._copiedTimer = setTimeout(() => {
          this.copied = false;
          this._copiedTimer = null;
        }, 1500);
        this.$emit('copy');
      }
    },
  },
};
</script>

<style scoped>
.view-source-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  /* ~300px side sheet; full-width overlay on narrow macros */
  width: min(300px, 100%);
  display: flex;
  flex-direction: column;
  background: #fff;
  border-left: 1px solid #E5E7EB;
  box-shadow: -4px 0 16px rgba(0, 0, 0, 0.06);
  z-index: 5;
  font-family: inherit;
}

.view-source-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid #E5E7EB;
  flex-shrink: 0;
}

.view-source-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: #172B4D;
  line-height: 1.3;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.view-source-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  padding: 0;
  background: transparent;
  color: #6B7280;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}
.view-source-close:hover {
  background: #F3F4F6;
  color: #111827;
}

.view-source-icon {
  width: 16px;
  height: 16px;
}

.view-source-code {
  flex: 1 1 auto;
  margin: 0;
  padding: 12px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  color: #111827;
  background: #F9FAFB;
  white-space: pre;
  word-break: normal;
  tab-size: 2;
}

.view-source-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  border-top: 1px solid #E5E7EB;
  background: #fff;
  flex-shrink: 0;
}

.view-source-meta {
  font-size: 12px;
  color: #6B7280;
}

.view-source-copy {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 4px 10px;
  background: #F3F4F6;
  color: #111827;
  border: 1px solid #E5E7EB;
  border-radius: 6px;
  font-family: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 150ms ease;
}
.view-source-copy:hover {
  background: #E5E7EB;
}
</style>
