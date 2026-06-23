<template>
  <div v-if="loading" class="flex justify-center items-center py-8">
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 animate-spin text-primary"><path d="M12 3a9 9 0 1 0 9 9"></path></svg>
    <span class="ml-2">Rendering PlantUML...</span>
  </div>
  <div v-else-if="error" class="text-red-600 py-4 px-2 text-sm">{{ error }}</div>
  <div v-else-if="!plantUmlCode" class="flex flex-col items-center justify-center py-16 px-8 text-center select-none">
    <div class="text-4xl mb-3">🌱</div>
    <div class="text-sm font-semibold text-violet-700 mb-1">Start with PlantUML</div>
    <div class="text-xs text-gray-400 mb-4">Type or paste PlantUML syntax in the editor</div>
    <pre class="text-left text-xs font-mono bg-gray-900 text-violet-300 rounded-lg px-5 py-4 leading-relaxed">@startuml
Alice -&gt; Bob: Hello
Bob --&gt; Alice: Hi there!
@enduml</pre>
  </div>
  <div v-else class="flex justify-center" v-html="svg"></div>
</template>

<script>
import { plantumlEncode } from '@/utils/plantuml/encode';
import { validatePlantUmlSyntax } from '@/utils/plantuml/validate';
import { DiagramType } from '@/model/Diagram/Diagram';
import globals from '@/model/globals';
import EventBus from '@/EventBus';
import { debounce } from 'lodash';
import { trackRenderTime } from '@/utils/analytics/trackRenderTime';
import { trackAnalyticsEvent } from '@/utils/analytics/trackAnalyticsEvent';
import * as renderPerf from '@/utils/analytics/renderPerf';
import { sanitizeSvg } from '@/utils/mermaid/sanitizeSvg';
import { getCachedSvg, putCachedSvg } from '@/utils/renderCache/renderCacheStore';

const PLANTUML_SERVER = 'https://www.plantuml.com/plantuml/svg/';

export default {
  name: 'PlantUml',
  props: {
    // When wrapped by the embed host, suppress this viewer's own macro_viewed.
    embedded: { type: Boolean, default: false },
  },
  data() {
    return {
      svg: null,
      loading: false,
      error: null,
      debouncedRender: null,
      initialRenderTracked: false,
    };
  },
  computed: {
    plantUmlCode() {
      return this.$store.state.diagram.diagramType === DiagramType.PlantUml && this.$store.state.diagram.plantUmlCode;
    },
    isDisplayMode() {
      return this.$store.getters.isDisplayMode;
    },
  },
  async mounted() {
    this.debouncedRender = debounce(this.fetchSvg, 500);
    if (!this.plantUmlCode) return;
    await this.validateAndRender(this.plantUmlCode, true);
    EventBus.$emit('diagramLoaded', this.plantUmlCode, this.$store.state.diagram.diagramType);
    await globals.apWrapper.initializeContext();
  },
  beforeUnmount() {
    if (this.debouncedRender) {
      this.debouncedRender.cancel();
    }
  },
  watch: {
    plantUmlCode(newVal) {
      if (!newVal) {
        this.svg = null;
        this.error = null;
        this.$store.dispatch('updateError', null);
      } else {
        this.validateAndRender(newVal);
      }
    },
  },
  methods: {
    tryInjectCached(rawSvg, cacheSource) {
      // Inject a cached SVG and skip the plantuml.com round-trip ENTIRELY. Sanitized on
      // read (both the body and localStorage are tamper surfaces). Returns false on a
      // miss / rejection so the caller falls through to the next tier.
      if (!rawSvg) return false;
      const safe = sanitizeSvg(rawSvg);
      if (!safe) return false;
      this.$store.dispatch('updateError', null);
      this.error = null;
      this.svg = safe;
      if (!this.initialRenderTracked) {
        this.initialRenderTracked = true;
        if (!this.embedded) trackRenderTime('plantuml', this.isDisplayMode, 'cached_svg', cacheSource);
        this.$emit('rendered');
      }
      return true;
    },
    async validateAndRender(code, immediate = false) {
      // Read order: cc_body (save-time, CROSS-USER — rides in the body) → localStorage
      // (per-browser view cache) → live render (validate + fetch plantuml.com).
      if (this.tryInjectCached(this.$store.state.diagram.plantUmlSvg, 'cc_body')) return;
      if (this.tryInjectCached(getCachedSvg(code), 'localstorage')) return;

      // Check if linter already validated and found an error
      // This avoids duplicate validation calls
      const currentError = this.$store.state.error;

      // First validate syntax
      const validationResult = await validatePlantUmlSyntax(code);
      
      if (!validationResult.valid) {
        // Update store error for SyntaxErrorBox (only if different)
        if (currentError !== validationResult.error) {
          this.$store.dispatch('updateError', validationResult.error);
        }
        // Also set local error
        this.error = validationResult.error;
        this.svg = null;
        return;
      }
      
      // Clear errors if validation passes
      this.$store.dispatch('updateError', null);

      // Proceed with rendering, reusing the SVG validation already fetched so we
      // don't issue a second identical request to the PlantUML server. The initial
      // view renders immediately; the 500ms debounce only coalesces live edits.
      if (immediate) {
        await this.fetchSvg(code, validationResult.svg);
      } else {
        this.debouncedRender(code, validationResult.svg);
      }
    },
    async fetchSvg(code, prefetchedSvg) {
      if (!code) return;
      this.loading = true;
      this.error = null;
      try {
        // Phase 0b: render_ms = PlantUML server round trip (recorded once).
        // Note this excludes the 500ms mount debounce, which lands in the
        // unattributed remainder — itself a finding for Phase 1.
        this.svg = await renderPerf.time('render', async () => {
          // Reuse the SVG the validator already downloaded (same encoded URL) —
          // eliminates a duplicate ~multi-second third-party round trip. Fall back
          // to a fetch only when no validated SVG is available.
          if (prefetchedSvg) return prefetchedSvg;
          const encoded = plantumlEncode(code);
          const response = await fetch(`${PLANTUML_SERVER}${encoded}`);
          if (!response.ok) {
            throw new Error(`PlantUML server returned ${response.status}`);
          }
          return await response.text();
        });
        // Warm the back-catalog view cache so the next view of this code skips the
        // plantuml.com round-trip. Best-effort, never throws.
        this.maybeCacheSvg(code, this.svg);
        if (!this.initialRenderTracked) {
          this.initialRenderTracked = true;
          if (!this.embedded) trackRenderTime('plantuml', this.isDisplayMode, 'live_render', 'none');
          this.$emit('rendered');
        }
      } catch (err) {
        console.error('PlantUML render error', err);
        this.error = `Failed to render PlantUML: ${err.message}`;
        this.$store.dispatch('updateError', this.error);
      } finally {
        this.loading = false;
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
          macro_type: 'plantuml',
          render_cache_outcome: OUTCOME[skip === null ? 'null' : skip],
          ...(skip === null ? { svg_bytes: svg.length } : {}),
        });
      } catch (e) {
        console.warn('plantuml render-cache write failed', e);
      }
    },
  },
};
</script>
