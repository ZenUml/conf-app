<template>
  <div class="agent-client-carousel" data-testid="agent-link-client-carousel">
    <span class="agent-client-carousel__eyebrow">Examples</span>
    <Transition name="agent-client-carousel-fade" mode="out-in">
      <span :key="current.label" class="agent-client-carousel__client" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="currentColor">
          <path :d="current.icon.path" />
        </svg>
        {{ current.label }}
      </span>
    </Transition>
    <span class="agent-client-carousel__sr-only">
      Compatible AI assistants include {{ accessibleLabels }}. This does not indicate what is installed or available.
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { WAITING_CLIENT_BRANDS } from './agentClientBrands'

const ROTATION_MS = 4000
const index = ref(0)
let timer: ReturnType<typeof setInterval> | null = null

const current = computed(() => WAITING_CLIENT_BRANDS[index.value] ?? WAITING_CLIENT_BRANDS[0])
const accessibleLabels = WAITING_CLIENT_BRANDS.map(({ label }) => label).join(', ')

onMounted(() => {
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  if (reducedMotion || WAITING_CLIENT_BRANDS.length < 2) return
  timer = setInterval(() => {
    index.value = (index.value + 1) % WAITING_CLIENT_BRANDS.length
  }, ROTATION_MS)
})

onBeforeUnmount(() => {
  if (timer !== null) clearInterval(timer)
})
</script>

<style scoped>
.agent-client-carousel {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 0;
  gap: 7px;
  min-height: 24px;
  padding: 3px 9px;
  border: 1px solid #e5e7eb;
  border-radius: 999px;
  color: #6b778c;
  background: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 11px;
}

.agent-client-carousel__eyebrow {
  color: #97a0af;
}

.agent-client-carousel__client {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 84px;
  color: #44546f;
  font-weight: 600;
}

.agent-client-carousel__client svg {
  width: 13px;
  height: 13px;
  flex: 0 0 13px;
}

.agent-client-carousel-fade-enter-active,
.agent-client-carousel-fade-leave-active {
  transition: opacity 180ms ease;
}

.agent-client-carousel-fade-enter-from,
.agent-client-carousel-fade-leave-to {
  opacity: 0;
}

.agent-client-carousel__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}

@media (prefers-reduced-motion: reduce) {
  .agent-client-carousel-fade-enter-active,
  .agent-client-carousel-fade-leave-active {
    transition: none;
  }
}

@media (prefers-color-scheme: dark) {
  .agent-client-carousel {
    border-color: #3a3f4b;
    color: #9aa3b2;
    background: #1d1f27;
  }
  .agent-client-carousel__client {
    color: #e6e8ee;
  }
}
</style>
