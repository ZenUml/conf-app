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
  <div v-else class="flex justify-center plantuml-render" :style="intrinsicSizeVars" v-html="svg"></div>
</template>

<script>
import { plantumlEncode } from '@/utils/plantuml/encode';
import { validatePlantUmlSyntax } from '@/utils/plantuml/validate';
import { normalizePlantUmlSvg, readPlantUmlSvgSize } from '@/utils/plantuml/normalizeSvg';
import { DiagramType } from '@/model/Diagram/Diagram';
import globals from '@/model/globals';
import EventBus from '@/EventBus';
import { debounce } from 'lodash';
import { trackRenderTime } from '@/utils/analytics/trackRenderTime';
import * as renderPerf from '@/utils/analytics/renderPerf';

const PLANTUML_SERVER = 'https://www.plantuml.com/plantuml/svg/';

export default {
  name: 'PlantUml',
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
    // Normalising drops the SVG's width/height, so fullscreen has no other way to
    // render the diagram at 1:1 and scroll to it. Published as custom properties
    // rather than inline width/height: only the fullscreen rule opts in, the
    // inline viewer keeps the fit-to-width behaviour.
    intrinsicSizeVars() {
      const size = this.svg ? readPlantUmlSvgSize(this.svg) : null;
      if (!size) return null;
      return {
        '--plantuml-intrinsic-width': `${size.width}px`,
        '--plantuml-intrinsic-height': `${size.height}px`,
      };
    },
  },
  async mounted() {
    this.debouncedRender = debounce(this.fetchSvg, 500);
    if (!this.plantUmlCode) return;
    await this.validateAndRender(this.plantUmlCode);
    // Type may have switched during the async render — the gated computed
    // would then be `false` and the store diagramType stale. Skip; the new
    // type's component emits its own diagramLoaded.
    if (this.plantUmlCode) {
      EventBus.$emit('diagramLoaded', this.plantUmlCode, DiagramType.PlantUml);
    }
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
    async validateAndRender(code) {
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
      
      // Proceed with rendering
      this.debouncedRender(code);
    },
    async fetchSvg(code) {
      if (!code) return;
      this.loading = true;
      this.error = null;
      try {
        // Phase 0b: render_ms = PlantUML server round trip (recorded once).
        // Note this excludes the 500ms mount debounce, which lands in the
        // unattributed remainder — itself a finding for Phase 1.
        this.svg = await renderPerf.time('render', async () => {
          const encoded = plantumlEncode(code);
          const response = await fetch(`${PLANTUML_SERVER}${encoded}`);
          if (!response.ok) {
            throw new Error(`PlantUML server returned ${response.status}`);
          }
          // The server's root pins a pixel width and preserveAspectRatio="none";
          // injected into a flex parent that squashes one axis (conf-app#626).
          return normalizePlantUmlSvg(await response.text());
        });
        if (!this.initialRenderTracked) {
          this.initialRenderTracked = true;
          trackRenderTime('plantuml', this.isDisplayMode);
        }
      } catch (err) {
        console.error('PlantUML render error', err);
        this.error = `Failed to render PlantUML: ${err.message}`;
        this.$store.dispatch('updateError', this.error);
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>

<style scoped>
/* The fit-to-width cap lives here rather than inline on the SVG, so the fullscreen
   rule in GenericViewer.vue can raise it and render the diagram at 1:1 with a
   scrollbar (conf-app#626). `:deep` because the SVG arrives through `v-html`. */
.plantuml-render :deep(svg) {
  max-width: 100%;
}
</style>
