<template>
  <div class="mermaid-root" :class="{ 'mermaid-root--editor': !isDisplayMode }">
    <div v-if="!mermaidCode" class="flex flex-col items-center justify-center py-16 px-8 text-center select-none">
      <div class="text-4xl mb-3">🌿</div>
      <div class="text-sm font-semibold text-emerald-700 mb-1">Start with Mermaid</div>
      <div class="text-xs text-gray-400 mb-4">Type or paste Mermaid syntax in the editor</div>
      <pre class="text-left text-xs font-mono bg-gray-900 text-emerald-300 rounded-lg px-5 py-4 leading-relaxed">sequenceDiagram
    Alice-&gt;&gt;John: Hello John!
    John--&gt;&gt;Alice: Hi Alice!</pre>
    </div>
    <DiagramViewport
      v-else
      ref="viewport"
      macro-type="mermaid"
      label="Mermaid"
      content-class="mermaid-diagram flex justify-center"
      :html="svg"
    />
  </div>
</template>

<script>
import { loadMermaid } from '@/utils/mermaid/loadMermaid'
import { normalizeSvgSizing } from '@/utils/mermaid/normalizeSvgSizing'
import { normalizeMermaidWhitespace } from '@/utils/mermaid/normalizeWhitespace'
import EventBus from "@/EventBus";
import {DiagramType} from "@/model/Diagram/Diagram";
import globals from '@/model/globals';
import { trackRenderTime } from '@/utils/analytics/trackRenderTime';
import { trackViewerRenderCrash } from '@/utils/analytics/trackViewerRenderCrash';
import { hasLayout, awaitLayout } from '@/utils/renderGate/documentLayout';
import * as renderPerf from '@/utils/analytics/renderPerf';
import DiagramViewport from '@/components/Viewer/DiagramViewport.vue';

export default {
  name: "Mermaid",
  components: { DiagramViewport },
  data() {
    return {
      svg: null,
      renderId: null,
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
    // Phase 0b: render_ms = loadMermaid + mermaid.render — exactly what an SVG
    // cache (Lever D) would skip. Only the initial mount render is timed
    // (renderPerf records once); the watch-driven re-render below is not.
    this.svg = await renderPerf.time('render', () => this.render(this.mermaidCode));
    await this.initializeViewport();
    trackRenderTime('mermaid', this.isDisplayMode);
    // Type may have switched during the async render — the gated computed
    // would then be `false` and the store diagramType stale. Skip; the new
    // type's component emits its own diagramLoaded.
    if (this.mermaidCode) {
      EventBus.$emit('diagramLoaded', this.mermaidCode, DiagramType.Mermaid);
    }
    await globals.apWrapper.initializeContext();
  },
  watch: {
    async mermaidCode(newVal) {
      if (!newVal) {
        this.svg = null;
      } else {
        this.svg = await this.render(this.mermaidCode);
        await this.initializeViewport();
      }
    }
  },
  methods: {
    /** Re-bind the pan/zoom viewport after the slotted SVG changes. */
    initializeViewport() {
      return this.$refs.viewport?.attach();
    },
    async runMermaid(code) {
      // Generate a unique ID to avoid conflicts
      this.renderId = `mermaid-${crypto.randomUUID()}`;
      const mermaid = await loadMermaid();
      // Bodies stored before the save-time normalisation still carry pasted
      // U+00A0, which mermaid's Langium grammars refuse. Normalising here is
      // what makes those diagrams render again without a data migration.
      const source = normalizeMermaidWhitespace(code);
      // Use the unique ID to render, avoiding creating extra elements in the body
      const { svg } = await mermaid.render(this.renderId, source);
      // A `useMaxWidth: false` diagram carries a fixed height that our flex
      // wrapper cannot shrink, which letterboxes the drawing. See
      // normalizeSvgSizing for the measurement.
      return normalizeSvgSizing(svg);
    },
    removeTempNode() {
      if (!this.renderId) return;
      document.getElementById(`d${this.renderId}`)?.remove();
    },
    reportCrash(error) {
      console.error('mermaid render error', error);
      // reliability-audit-2026-08-06 §3/§12.1: a mermaid.js exception used to
      // be console.error-only — the blank result still got recorded as a
      // successful macro_viewed by mounted()'s unconditional trackRenderTime.
      // This adds the missing failure signal without changing that existing
      // (silent-degrade) UX.
      trackViewerRenderCrash('mermaid', this.isDisplayMode, error);
      this.removeTempNode();
    },
    async render(code) {
      try {
        return await this.runMermaid(code);
      } catch (error) {
        this.removeTempNode();
        // mermaid measures a temp node with getBBox. In a document with no
        // layout box that measurement throws `svg element not in render tree`
        // and the same input renders cleanly once the box exists (reproduced
        // against mermaid 11.12.2 in Chrome — see renderGate/documentLayout).
        // Retry rather than leave the reader with a permanently blank diagram.
        if (!hasLayout()) {
          // Off the awaited path on purpose: the wait can last until a hidden
          // iframe is shown, and folding that into the caller would report it
          // as render_ms. The retry assigns this.svg when it lands.
          this.retryAfterLayout(code);
          return;
        }
        // With a layout box present the failure is deterministic (bad syntax,
        // an unsupported diagram type); a retry would only repeat it.
        this.reportCrash(error);
      }
    },
    async retryAfterLayout(code) {
      await awaitLayout();
      try {
        const svg = await this.runMermaid(code);
        // The diagram may have been edited or switched away during the wait.
        if (this.mermaidCode === code) {
          this.svg = svg;
          await this.initializeViewport();
        }
      } catch (error) {
        this.reportCrash(error);
      }
    }
  }
}
</script>

<style scoped>
/* The editor preview is a fixed-height pane (Workspace.vue makes the column a
   flex box). This is the first link of the chain that lets DiagramViewport fill
   it instead of collapsing to the diagram's height. */
.mermaid-root--editor {
  height: 100%;
  min-height: 0;
}
</style>
