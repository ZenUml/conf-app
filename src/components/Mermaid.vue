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
import { renderMermaid } from '@/utils/mermaid/renderMermaid'
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
      renderGeneration: 0,
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
    const code = this.mermaidCode;
    if (!code) return;
    const applied = await this.renderAndApply(code, true);
    if (applied) {
      trackRenderTime('mermaid', this.isDisplayMode);
      EventBus.$emit('diagramLoaded', code, DiagramType.Mermaid);
    }
    await globals.apWrapper.initializeContext();
  },
  beforeUnmount() {
    // An already queued render may finish after this component is gone.
    this.renderGeneration++;
  },
  watch: {
    async mermaidCode(newVal) {
      if (!newVal) {
        this.renderGeneration++;
        this.svg = null;
      } else {
        await this.renderAndApply(newVal);
      }
    }
  },
  methods: {
    /** Re-bind the pan/zoom viewport after the slotted SVG changes. */
    initializeViewport() {
      return this.$refs.viewport?.attach();
    },
    async renderAndApply(code, measureInitialAttempt = false) {
      const generation = ++this.renderGeneration;
      const svg = await this.render(code, measureInitialAttempt);
      // Latest request wins. This also prevents a queued result from writing
      // into a component that changed diagram type or was unmounted.
      if (!svg || generation !== this.renderGeneration || this.mermaidCode !== code) {
        return false;
      }
      this.svg = svg;
      await this.$nextTick();
      if (generation !== this.renderGeneration || this.mermaidCode !== code) {
        return false;
      }
      await this.initializeViewport();
      return true;
    },
    async runMermaid(code) {
      const renderId = `mermaid-${crypto.randomUUID()}`;
      // Bodies stored before the save-time normalisation still carry pasted
      // U+00A0, which mermaid's Langium grammars refuse. Normalising here is
      // what makes those diagrams render again without a data migration.
      const source = normalizeMermaidWhitespace(code);
      const { svg } = await renderMermaid(renderId, source);
      // A `useMaxWidth: false` diagram carries a fixed height that our flex
      // wrapper cannot shrink, which letterboxes the drawing. See
      // normalizeSvgSizing for the measurement.
      return normalizeSvgSizing(svg);
    },
    reportCrash(error) {
      console.error('mermaid render error', error);
      // reliability-audit-2026-08-06 §3/§12.1: a mermaid.js exception used to
      // be console.error-only and the blank result was recorded as a successful
      // macro_viewed. This path runs only after any safe retry is exhausted;
      // mounted() now records macro_viewed only when an SVG was actually applied.
      trackViewerRenderCrash('mermaid', this.isDisplayMode, error);
    },
    isTransientRenderError(error) {
      const message = error instanceof Error ? error.message : String(error ?? '');
      return message.includes('svg element not in render tree')
        || /matrix (?:is )?(?:not |non[- ]?)invertible/i.test(message);
    },
    async render(code, measureInitialAttempt = false) {
      const firstAttempt = () => measureInitialAttempt
        ? renderPerf.time('render', () => this.runMermaid(code))
        : this.runMermaid(code);
      try {
        return await firstAttempt();
      } catch (error) {
        // mermaid measures a temp node with getBBox. In a document with no
        // layout box that measurement throws `svg element not in render tree`
        // and the same input renders cleanly once the box exists (reproduced
        // against mermaid 11.12.2 in Chrome — see renderGate/documentLayout).
        // Production also showed this exact transient while body layout was
        // present. Retry it once after the queue has cleaned up; deterministic
        // parser errors still fail immediately.
        if (hasLayout() && !this.isTransientRenderError(error)) {
          this.reportCrash(error);
          return;
        }
        await awaitLayout();
        try {
          return await this.runMermaid(code);
        } catch (retryError) {
          this.reportCrash(retryError);
        }
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
