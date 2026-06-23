<template>
  <div>
    <div v-if="!mermaidCode" class="flex flex-col items-center justify-center py-16 px-8 text-center select-none">
      <div class="text-4xl mb-3">🌿</div>
      <div class="text-sm font-semibold text-emerald-700 mb-1">Start with Mermaid</div>
      <div class="text-xs text-gray-400 mb-4">Type or paste Mermaid syntax in the editor</div>
      <pre class="text-left text-xs font-mono bg-gray-900 text-emerald-300 rounded-lg px-5 py-4 leading-relaxed">sequenceDiagram
    Alice-&gt;&gt;John: Hello John!
    John--&gt;&gt;Alice: Hi Alice!</pre>
    </div>
    <div v-else class="flex justify-center" v-html="svg"></div>
  </div>
</template>

<script>
import { loadMermaid } from '@/utils/mermaid/loadMermaid'
import EventBus from "@/EventBus";
import {DiagramType} from "@/model/Diagram/Diagram";
import globals from '@/model/globals';
import { trackRenderTime } from '@/utils/analytics/trackRenderTime';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import * as renderPerf from '@/utils/analytics/renderPerf';
import { sanitizeSvg } from '@/utils/mermaid/sanitizeSvg';
import { getCachedSvg, putCachedSvg } from '@/utils/renderCache/renderCacheStore';

export default {
  name: "Mermaid",
  props: {
    // When wrapped by the embed host, suppress this viewer's own macro_viewed —
    // the host emits a single macro_type='embed' event instead.
    embedded: { type: Boolean, default: false },
  },
  data() {
    return {
      svg: null,
      renderId: null
    }
  },
  computed: {
    mermaidCode() {
      return this.$store.state.diagram.diagramType === DiagramType.Mermaid && this.$store.state.diagram.mermaidCode;
    },
    isDisplayMode() {
      return this.$store.getters.isDisplayMode;
    },
  },
  async mounted() {
    if (!this.mermaidCode) return;
    // Phase 0b: render_ms = loadMermaid + mermaid.render. Lever D skips BOTH when a
    // pre-rendered SVG is present in the custom-content body: sanitize it and inject
    // directly (render_ms collapses to the cheap scrub; resource_load avoids the
    // mermaid vendor bundle). Falls back to live render when absent/rejected. Only
    // the initial mount render is timed (renderPerf records once).
    let renderMode = 'live_render';
    let cacheSource = 'none';
    let liveRendered = null;
    const code = this.mermaidCode;
    const cachedSvg = this.$store.state.diagram.mermaidSvg;
    this.svg = await renderPerf.time('render', async () => {
      // 1) cc_body (Lever D save-time cache, re-saved macros).
      if (cachedSvg) {
        const safe = sanitizeSvg(cachedSvg);
        if (safe) {
          renderMode = 'cached_svg';
          cacheSource = 'cc_body';
          return safe;
        }
      }
      // 2) back-catalog localStorage view-cache — skips loadMermaid()+render() AND the
      //    mermaid bundle eval on revisit (the bundle bytes are HTTP-warm but parsing/
      //    executing them is real CPU). Sanitized on read (tamper surface).
      const lsSvg = getCachedSvg(code);
      if (lsSvg) {
        const safe = sanitizeSvg(lsSvg);
        if (safe) {
          renderMode = 'cached_svg';
          cacheSource = 'localstorage';
          return safe;
        }
      }
      // 3) live render.
      liveRendered = await this.render(code);
      return liveRendered;
    });
    // Warm the view cache so the next visit skips the bundle entirely.
    if (liveRendered) this.maybeCacheSvg(code, liveRendered);
    if (!this.embedded) trackRenderTime('mermaid', this.isDisplayMode, renderMode, cacheSource);
    this.$emit('rendered');
    EventBus.$emit('diagramLoaded', this.mermaidCode, this.$store.state.diagram.diagramType);
    await globals.apWrapper.initializeContext();
  },
  updated() {
    // Don't use updated() to render, because it will cause infinite loop.
  },
  watch: {
    async mermaidCode(newVal) {
      if (!newVal) {
        this.svg = null;
      } else {
        this.svg = await this.render(this.mermaidCode);
      }
    }
  },
  methods: {
    async render(code) {
      // Generate a unique ID to avoid conflicts
      this.renderId = `mermaid-${crypto.randomUUID()}`;
      try {
        // resource_load_ms = loading our mermaid vendor bundle; render_ms =
        // mermaid's own layout/render. Disjoint phases — the nested time('render')
        // resolves before the mounted() wrapper, so render_ms isn't double-counted.
        const mermaid = await renderPerf.time('resource', () => loadMermaid());
        // Use the unique ID to render, avoiding creating extra elements in the body
        const { svg } = await renderPerf.time('render', () => mermaid.render(this.renderId, code));
        return svg;
      } catch (error) {
        console.error('mermaid render error', error);
        if (this.renderId) {
          const tempElement = document.getElementById(`d${this.renderId}`);
          tempElement?.remove();
        }
      }
    },
    maybeCacheSvg(code, svg) {
      try {
        const skip = putCachedSvg(code, svg);
        const OUTCOME = {
          null: 'persisted',
          oversized: 'skipped_oversized',
          unsupported: 'skipped_unsupported',
          no_write: 'skipped_no_write',
        };
        trackAnalyticsEvent('render_cache_write', {
          feature_area: 'macro',
          surface: 'viewer',
          macro_type: 'mermaid',
          render_cache_outcome: OUTCOME[skip === null ? 'null' : skip],
          ...(skip === null ? { svg_bytes: svg.length } : {}),
        });
      } catch (e) {
        console.warn('mermaid render-cache write failed', e);
      }
    }
  }
}
</script>
