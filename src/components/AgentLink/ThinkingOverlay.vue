<template>
  <div
    v-if="state !== 'idle'"
    class="agent-thinking-overlay"
    :class="`agent-thinking-overlay--${state}`"
    data-testid="agent-thinking-overlay"
    role="status"
    aria-live="polite"
    :aria-label="state === 'thinking' ? 'Agent is updating the diagram' : 'Agent edit did not apply'"
  >
    <div class="agent-thinking-overlay__chip" data-testid="agent-thinking-chip">
      <svg
        v-if="state === 'thinking'"
        class="agent-thinking-overlay__spinner"
        data-testid="agent-thinking-spinner"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.8"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
        />
      </svg>
      <svg
        v-else
        class="agent-thinking-overlay__error-icon"
        data-testid="agent-thinking-error-icon"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.8"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
        />
      </svg>
      <span class="agent-thinking-overlay__label" data-testid="agent-thinking-label">{{ label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
// Soft "AI is thinking" overlay on the diagram render surface (charter §6
// Track F). Renders NOTHING when idle so the flag-off / no-session path is
// DOM-identical. Follows the ZenUML-for-Confluence Design System: an async
// state is ArrowPathIcon + animate-spin over a subtle dim — NOT a skeleton
// shimmer sweep, no bounces/springs/entry animations. The warm-cream canvas
// (#F8F7F4) underneath is never repainted; we only lay a translucent scrim +
// gentle saturate over it, so the COMPLETE existing diagram stays visible
// (hard constraint: no partial/streaming preview — the new diagram replaces it
// only once fully rendered). pointer-events:none so the overlay never swallows
// clicks on the diagram beneath.
import { computed } from 'vue'
import type { AgentLinkThinkingState } from '@/composables/agentLink/agentLinkState'

const props = defineProps<{
  state: AgentLinkThinkingState
}>()

const label = computed(() =>
  props.state === 'thinking' ? 'Agent is updating the diagram…' : 'Agent edit did not apply'
)
</script>

<style scoped>
.agent-thinking-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  /* Subtle dim + slight desaturate of the diagram beneath — the design
     system's "subtle dim/desaturate", not an opaque cover. The warm-cream
     canvas is untouched; this only sits above it. */
  background: rgba(248, 247, 244, 0.55);
  -webkit-backdrop-filter: saturate(0.78);
  backdrop-filter: saturate(0.78);
  transition: background-color 200ms ease;
}

.agent-thinking-overlay--error {
  background: rgba(248, 247, 244, 0.62);
}

.agent-thinking-overlay__chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  border-radius: 999px;
  background: #ffffff;
  border: 1px solid #e3e6ea;
  box-shadow: 0 2px 10px rgba(23, 43, 77, 0.12);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  font-weight: 500;
  color: #172b4d;
}

.agent-thinking-overlay--thinking .agent-thinking-overlay__chip {
  color: #5936d9;
  /* Gentle opacity breathe (opacity only — no transform bounce/spring). */
  animation: agent-thinking-breathe 1.8s ease-in-out infinite;
}

.agent-thinking-overlay--error .agent-thinking-overlay__chip {
  color: #b2431f;
  border-color: #f0c9ba;
}

.agent-thinking-overlay__spinner {
  width: 16px;
  height: 16px;
  /* The design system's sanctioned async pattern: ArrowPathIcon + animate-spin. */
  animation: agent-thinking-spin 1s linear infinite;
}

.agent-thinking-overlay__error-icon {
  width: 16px;
  height: 16px;
}

.agent-thinking-overlay__label {
  white-space: nowrap;
}

@keyframes agent-thinking-spin {
  to {
    transform: rotate(360deg);
  }
}

@keyframes agent-thinking-breathe {
  0%,
  100% {
    opacity: 0.82;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-color-scheme: dark) {
  .agent-thinking-overlay {
    background: rgba(29, 31, 39, 0.5);
  }
  .agent-thinking-overlay--error {
    background: rgba(29, 31, 39, 0.58);
  }
  .agent-thinking-overlay__chip {
    background: #1d1f27;
    border-color: #3a3f4b;
    color: #e6e8ee;
  }
  .agent-thinking-overlay--thinking .agent-thinking-overlay__chip {
    color: #b3a3f7;
  }
  .agent-thinking-overlay--error .agent-thinking-overlay__chip {
    color: #f0a88c;
    border-color: #5c3a2c;
  }
}

/* Respect reduced-motion: drop the spin + breathe, keep the static cue. */
@media (prefers-reduced-motion: reduce) {
  .agent-thinking-overlay__spinner {
    animation: none;
  }
  .agent-thinking-overlay--thinking .agent-thinking-overlay__chip {
    animation: none;
  }
}
</style>
