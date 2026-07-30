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
import * as renderPerf from '@/utils/analytics/renderPerf';
import { viewerRenderReporterKey } from '@/utils/viewerRenderReporter';

export default {
  name: "Mermaid",
  inject: {
    viewerRenderReporter: {
      from: viewerRenderReporterKey,
      default: null,
    },
  },
  data() {
    return {
      svg: null,
      renderId: null,
      legacyRenderReported: false,
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
    if (!this.mermaidCode) {
      this.reportRendered(this.viewerRenderReporter?.captureRevision() ?? 0);
      return;
    }
    // Phase 0b: render_ms = loadMermaid + mermaid.render — exactly what an SVG
    // cache (Lever D) would skip. Only the initial mount render is timed
    // (renderPerf records once); the watch-driven re-render below is not.
    this.svg = await renderPerf.time('render', () => this.render(this.mermaidCode));
    // Type may have switched during the async render — the gated computed
    // would then be `false` and the store diagramType stale. Skip; the new
    // type's component emits its own diagramLoaded.
    if (this.mermaidCode) {
      EventBus.$emit('diagramLoaded', this.mermaidCode, DiagramType.Mermaid);
    }
    await globals.apWrapper.initializeContext();
  },
  updated() {
    // Don't use updated() to render, because it will cause infinite loop.
  },
  watch: {
    async mermaidCode(newVal) {
      if (!newVal) {
        this.svg = null;
        this.reportRendered(this.viewerRenderReporter?.captureRevision() ?? 0);
      } else {
        this.svg = await this.render(this.mermaidCode);
      }
    }
  },
  methods: {
    async render(code) {
      const revision = this.viewerRenderReporter?.captureRevision() ?? 0;
      // Generate a unique ID to avoid conflicts
      this.renderId = `mermaid-${crypto.randomUUID()}`;
      try {
        const mermaid = await loadMermaid();
        // Use the unique ID to render, avoiding creating extra elements in the body
        const { svg } = await mermaid.render(this.renderId, code);
        this.reportRendered(revision);
        return svg;
      } catch (error) {
        console.error('mermaid render error', error);
        if (this.renderId) {
          const tempElement = document.getElementById(`d${this.renderId}`);
          tempElement?.remove();
        }
        this.viewerRenderReporter?.failed(revision, error);
      }
    },
    reportRendered(revision) {
      if (this.viewerRenderReporter && revision > 0) {
        this.viewerRenderReporter.rendered(revision);
      } else if (!this.viewerRenderReporter && !this.legacyRenderReported) {
        this.legacyRenderReported = true;
        trackRenderTime('mermaid', this.isDisplayMode);
      }
    }
  }
}
</script>
