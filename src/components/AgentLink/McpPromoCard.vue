<template>
  <aside
    class="mcp-promo"
    :class="`mcp-promo--${variant}`"
    role="complementary"
    :aria-label="title"
    :data-testid="`mcp-promo-${variant}`"
  >
    <div class="mcp-promo-icon" aria-hidden="true">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22v-5" /><path d="M9 8V2" /><path d="M15 8V2" />
        <path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z" />
      </svg>
    </div>
    <div class="mcp-promo-text">
      <p class="mcp-promo-title">{{ title }}</p>
      <p v-if="body" class="mcp-promo-body">{{ body }}</p>
      <div class="mcp-promo-actions">
        <button
          type="button"
          class="mcp-promo-cta"
          :data-testid="`mcp-promo-${variant}-cta`"
          @click="emit('cta')"
        >{{ ctaLabel }}</button>
        <button
          v-if="secondaryLabel"
          type="button"
          class="mcp-promo-secondary"
          :data-testid="`mcp-promo-${variant}-secondary`"
          @click="emit('secondary')"
        >{{ secondaryLabel }}</button>
      </div>
    </div>
    <button
      type="button"
      class="mcp-promo-close"
      aria-label="Dismiss"
      title="Don't show again"
      :data-testid="`mcp-promo-${variant}-dismiss`"
      @click="emit('dismiss')"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M18 6 6 18" /><path d="m6 6 12 12" />
      </svg>
    </button>
  </aside>
</template>

<script setup lang="ts">
// One-action promo for the Connect MCP dialog (design: Figma "ZenUML – MCP
// promo mockups"). `card` floats over a diagram (Fullscreen, editor
// new-diagram); `tip` is the dark, docked variant for the editor code pane.
// Display rules (dismissed / session cap / engaged) belong to the host via
// mcpPromo.ts; this component only renders and emits.
withDefaults(
  defineProps<{
    variant?: 'card' | 'tip'
    title: string
    body?: string
    ctaLabel?: string
    secondaryLabel?: string
  }>(),
  { variant: 'card', body: '', ctaLabel: 'Connect MCP Server', secondaryLabel: '' },
)

const emit = defineEmits<{
  (e: 'cta'): void
  (e: 'secondary'): void
  (e: 'dismiss'): void
}>()
</script>

<style scoped>
.mcp-promo {
  position: relative;
  display: flex;
  gap: 10px;
  box-sizing: border-box;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  text-align: left;
}

.mcp-promo--card {
  width: 300px;
  max-width: calc(100% - 16px);
  flex-direction: column;
  padding: 16px;
  background: #fff;
  border: 1px solid #DCDFE4;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(9, 30, 66, 0.18);
  color: #172B4D;
}

.mcp-promo--tip {
  width: 100%;
  align-items: flex-start;
  padding: 10px 32px 10px 12px;
  background: #2C333A;
  border: 1px solid rgba(143, 126, 231, 0.6);
  border-radius: 6px;
  color: #E2E4E9;
}

.mcp-promo-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.mcp-promo--card .mcp-promo-icon {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  background: #F3F0FF;
  color: #6E5DC6;
}
.mcp-promo--card .mcp-promo-icon svg { width: 18px; height: 18px; }
.mcp-promo--tip .mcp-promo-icon { color: #B8ACF6; padding-top: 1px; }
.mcp-promo--tip .mcp-promo-icon svg { width: 16px; height: 16px; }

.mcp-promo-text {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.mcp-promo-title {
  margin: 0;
  font-weight: 600;
  line-height: 1.35;
}
.mcp-promo--card .mcp-promo-title { font-size: 15px; }
.mcp-promo--tip .mcp-promo-title { font-size: 13px; font-weight: 500; }

.mcp-promo-body {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: #44546F;
}

.mcp-promo-actions {
  display: flex;
  gap: 8px;
  margin-top: 4px;
}

.mcp-promo--card .mcp-promo-cta {
  flex: 1;
  padding: 6px 12px;
  border: 0;
  border-radius: 4px;
  background: #0C66E4;
  color: #fff;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}
.mcp-promo--card .mcp-promo-cta:hover { background: #0055CC; }

.mcp-promo--tip .mcp-promo-cta {
  padding: 0;
  border: 0;
  background: none;
  color: #B8ACF6;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}
.mcp-promo--tip .mcp-promo-cta::after { content: " →"; }
.mcp-promo--tip .mcp-promo-cta:hover { text-decoration: underline; }

.mcp-promo-secondary {
  padding: 6px 12px;
  border: 0;
  border-radius: 4px;
  background: rgba(9, 30, 66, 0.06);
  color: #172B4D;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.mcp-promo-close {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  padding: 2px;
  border: 0;
  border-radius: 4px;
  background: none;
  color: #626F86;
  cursor: pointer;
}
.mcp-promo-close svg { width: 16px; height: 16px; }
.mcp-promo-close:hover { background: rgba(9, 30, 66, 0.08); }
.mcp-promo--tip .mcp-promo-close { color: #8C9BAB; top: 8px; right: 8px; }
.mcp-promo--tip .mcp-promo-close:hover { background: rgba(255, 255, 255, 0.08); }

.mcp-promo-cta:focus-visible,
.mcp-promo-secondary:focus-visible,
.mcp-promo-close:focus-visible {
  outline: 2px solid #388BFF;
  outline-offset: 2px;
}
</style>
