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
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";
import globals from '@/model/globals';

export default {
  name: "Mermaid",
  data() {
    return {
      svg: null,
      renderId: null
    }
  },
  computed: {
    mermaidCode() {
      return this.$store.state.diagram.diagramType === DiagramType.Mermaid && this.$store.state.diagram.mermaidCode;
    }
  },
  async mounted() {
    if (!this.mermaidCode) return;
    this.svg = await this.render(this.mermaidCode);
    EventBus.$emit('diagramLoaded', this.mermaidCode, this.$store.state.diagram.diagramType);
    await globals.apWrapper.initializeContext();
    trackAnalyticsEvent("macro_viewed", {
      feature_area: "macro",
      surface: "viewer",
      macro_type: "mermaid",
      entry_point: "page_view",
    });
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
        const mermaid = await loadMermaid();
        // Use the unique ID to render, avoiding creating extra elements in the body
        const { svg } = await mermaid.render(this.renderId, code);
        return svg;
      } catch (error) {
        console.error('mermaid render error', error);
        if (this.renderId) {
          const tempElement = document.getElementById(`d${this.renderId}`);
          tempElement?.remove();
        }
      }
    }
  }
}
</script>
