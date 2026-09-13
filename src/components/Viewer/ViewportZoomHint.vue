<template>
  <div v-if="visible" class="viewport-zoom-hint" aria-hidden="true">
    Use <kbd>⌘</kbd>/<kbd>Ctrl</kbd> + scroll to zoom
  </div>
</template>

<script>
/**
 * The overlay that tells a reader how to zoom, shown at the moment they tried.
 *
 * Wheel zoom is gated on Ctrl/Cmd so a plain wheel can scroll the page
 * (`isZoomIntent`), which leaves the gesture undiscoverable: nothing on the
 * surface says the modifier exists. The toolbar's tooltips carry it for anyone
 * who hovers the zoom buttons; this catches the rest, at the only moment the
 * information is wanted — the wheel just did nothing and they noticed.
 *
 * `aria-hidden`: a mouse gesture is not an affordance a screen-reader user can
 * take, and announcing it would interrupt for nothing. The zoom buttons are the
 * keyboard-reachable path and they are already labelled.
 *
 * The parent decides WHEN (it owns the wheel listener and the surface rules) and
 * calls `show()`; the timer and the analytics live here so there is one place
 * that gets the teardown right.
 */
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import { viewportSurface } from '@/utils/viewport/surface';

/** Long enough to read six words, short enough not to sit on the diagram. */
const VISIBLE_MS = 2600;

export default {
  name: 'ViewportZoomHint',
  props: {
    /** Analytics `macro_type` — the renderer this viewport is driving. */
    macroType: {
      type: String,
      required: true,
    },
  },
  data() {
    return { visible: false, timer: null };
  },
  beforeUnmount() {
    clearTimeout(this.timer);
    this.timer = null;
  },
  methods: {
    show() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => { this.visible = false; }, VISIBLE_MS);
      // Re-showing while already visible only extends it; the reader is looking
      // at the same message, so it is one telling, not two.
      if (this.visible) return;
      this.visible = true;
      trackAnalyticsEvent('viewport_zoom_hint_shown', {
        feature_area: 'macro',
        surface: viewportSurface(this.$store.getters.isDisplayMode),
        macro_type: this.macroType,
      });
    },
  },
};
</script>

<style scoped>
.viewport-zoom-hint {
  position: absolute;
  z-index: 3;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  border-radius: 6px;
  color: #fff;
  background: rgba(23, 43, 77, 0.9);
  box-shadow: 0 2px 8px rgba(9, 30, 66, 0.25);
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  pointer-events: none;
  animation: viewport-zoom-hint-in 120ms ease-out;
}

.viewport-zoom-hint kbd {
  padding: 0 4px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  border-radius: 3px;
  font-family: inherit;
  font-size: 11px;
}

@keyframes viewport-zoom-hint-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

/* The hint is a transient nicety, not information: honour a reduced-motion
   preference by simply appearing. */
@media (prefers-reduced-motion: reduce) {
  .viewport-zoom-hint { animation: none; }
}
</style>
