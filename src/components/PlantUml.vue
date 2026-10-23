<template>
  <div class="plantuml-root" :class="{ 'plantuml-root--editor': !isDisplayMode }">
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
    <DiagramViewport
      v-else
      ref="viewport"
      macro-type="plantuml"
      label="PlantUML"
      content-class="plantuml-render flex justify-center"
      :html="svg"
      :style="intrinsicSizeVars"
    />
  </div>
</template>

<script>
import { fetchPlantUmlSvg } from '@/utils/plantuml/server';
import { validatePlantUmlSyntax } from '@/utils/plantuml/validate';
import { normalizePlantUmlSvg, readPlantUmlSvgSize } from '@/utils/plantuml/normalizeSvg';
import { DiagramType } from '@/model/Diagram/Diagram';
import globals from '@/model/globals';
import EventBus from '@/EventBus';
import { debounce } from 'lodash';
import { trackRenderTime } from '@/utils/analytics/trackRenderTime';
import { isLoadedEmptyBody, viewContentState } from '@/utils/analytics/contentState';
import * as renderPerf from '@/utils/analytics/renderPerf';
import DiagramViewport from '@/components/Viewer/DiagramViewport.vue';


export default {
  name: 'PlantUml',
  components: { DiagramViewport },
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
    // Normalising drops the SVG's width/height, so the Export PNG host has no other
    // way to render the diagram at 1:1 and scroll to it. Published as custom
    // properties rather than inline width/height: only the export-entry rule in
    // GenericViewer opts in. Live surfaces use DiagramViewport's zoom instead.
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
    // A whitespace-only loaded body is empty even if syntax validation below
    // rejects it. Preserve that validation/render path and report the view once.
    if (this.plantUmlCode && this.plantUmlCode.trim() === '' && isLoadedEmptyBody(this.$store.state.diagram, DiagramType.PlantUml)) {
      this.initialRenderTracked = true;
      trackRenderTime('plantuml', this.isDisplayMode, 'live_render', 'none', 'empty');
    }
    if (!this.plantUmlCode) {
      // #113: the embed viewer mounts the referenced document as stored,
      // without the main loader’s example fallback, so a wiped body
      // can arrive here. Report the view with the verdict, without rendering;
      // initialRenderTracked keeps a body that arrives later from being a
      // second view of this mount.
      if (!this.initialRenderTracked && isLoadedEmptyBody(this.$store.state.diagram, DiagramType.PlantUml)) {
        this.initialRenderTracked = true;
        trackRenderTime('plantuml', this.isDisplayMode, 'live_render', 'none', 'empty');
      }
      return;
    }
    // A page view: nothing is being typed, so the edit debounce would only
    // hold the already-fetched SVG back from first paint (~500 ms of the
    // viewer's unattributed load time, see #929's metric note).
    await this.validateAndRender(this.plantUmlCode, { immediate: true });
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
    // Not inside fetchSvg: the viewport only exists once `loading` flips back to
    // false in that method's `finally`, which runs after any `await` in the try.
    // Watching the rendered markup means the attach always sees a mounted ref.
    svg() {
      this.initializeViewport();
    },
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
    /** Re-bind the pan/zoom viewport after a new server SVG lands. */
    async initializeViewport() {
      await this.$nextTick();
      await this.$refs.viewport?.attach();
    },
    /**
     * `immediate` renders as soon as validation passes; the default holds the
     * render behind the 500 ms debounce, which is for keystrokes in the editor.
     */
    async validateAndRender(code, { immediate = false } = {}) {
      // Check if linter already validated and found an error
      // This avoids duplicate validation calls
      const currentError = this.$store.state.error;
      
      // First validate syntax
      const validationResult = await validatePlantUmlSyntax(code);

      // The active diagram may have changed while validation was pending.
      // Do not publish a PlantUML error for another diagram type or source.
      if (this.plantUmlCode !== code) return;
      
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
      if (immediate) {
        this.fetchSvg(code);
      } else {
        this.debouncedRender(code);
      }
    },
    async fetchSvg(code) {
      if (!code) return;
      this.loading = true;
      this.error = null;
      try {
        // Phase 0b: render_ms = time to get the server SVG (recorded once).
        // Usually that is the response validation just fetched (#929), so it is
        // near zero; the round trip itself lands in the unattributed remainder.
        // On first mount nothing else sits between validation and this call;
        // only edits go through the 500 ms debounce.
        this.svg = await renderPerf.time('render', async () => {
          const response = await fetchPlantUmlSvg(code);
          if (!response.ok) {
            throw new Error(`PlantUML server returned ${response.status}`);
          }
          // The server's root pins a pixel width and preserveAspectRatio="none";
          // injected into a flex parent that squashes one axis (conf-app#626).
          return normalizePlantUmlSvg(response.svgText);
        });
        if (!this.initialRenderTracked) {
          this.initialRenderTracked = true;
          trackRenderTime(
            'plantuml', this.isDisplayMode, 'live_render', 'none',
            viewContentState(this.$store.state.diagram, DiagramType.PlantUml),
          );
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
/* The fit-to-width cap lives here rather than inline on the SVG, so the
   export-entry rule in GenericViewer.vue can raise it and render the diagram at
   1:1 with a scrollbar (conf-app#626). On the live surfaces DiagramViewport
   overrides it on the element the moment pan/zoom attaches.
   The whole selector is inside `:deep()` because `.plantuml-render` now lives in
   DiagramViewport's template, so only the component's root carries this file's
   scope attribute. */
:deep(.plantuml-render svg) {
  max-width: 100%;
}

/* First link of the chain that lets DiagramViewport fill the fixed-height editor
   preview pane instead of collapsing to the diagram's height (see Mermaid.vue). */
.plantuml-root--editor {
  height: 100%;
  min-height: 0;
}
</style>
