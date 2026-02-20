<template>
  <div>
    <div class="flex justify-center" v-html="svg"></div>
  </div>
</template>

<script>
import mermaid from 'mermaid'
import EventBus from "@/EventBus";
import {DiagramType} from "@/model/Diagram/Diagram";
import {trackEvent} from "@/utils/window";
import globals from '@/model/globals';

mermaid.initialize({
  startOnLoad:true
})

export default {
  name: "Mermaid",
  data() {
    return {
      svg: 'Empty',
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
    trackEvent('', 'view_macro', DiagramType.Mermaid);
  },
  updated() {
    // Don't use updated() to render, because it will cause infinite loop.
  },
  watch: {
    async mermaidCode(newVal) {
      if (!newVal) {
        this.svg = 'Empty';
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
