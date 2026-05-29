<template>
  <div id="forge-embed-viewer">
    <div v-if="loading" class="loading">
      Loading embedded diagram...
    </div>
    <div v-else-if="error" class="error">
      {{ error }}
    </div>
    <div v-else class="embed-container">
      <!-- Dynamic component will be rendered here -->
      <component 
        v-if="viewerComponent" 
        :is="viewerComponent" 
        :doc="effectiveDoc"
        :graphXml="effectiveDoc?.graphXml"
        :code="effectiveDoc?.code"
        :mermaidCode="effectiveDoc?.mermaidCode"
      />
    </div>
  </div>
</template>

<script>
import { loadForgeViewerComponent } from "@/model/Diagram/DiagramTypeConfig";

export default {
  name: "ForgeEmbedViewer",
  props: {
    diagramType: String,
    doc: Object
  },
  data() {
    return {
      loading: true,
      error: null,
      viewerComponent: null
    }
  },
  async mounted() {
    await this.initializeViewer();
  },
  computed: {
    effectiveDoc() {
      return this.doc || this.$store.state.diagram;
    },
    effectiveDiagramType() {
      return this.diagramType || this.effectiveDoc?.diagramType;
    }
  },
  watch: {
    effectiveDiagramType() {
      this.initializeViewer();
    }
  },
  methods: {
    async initializeViewer() {
      if (this.effectiveDiagramType) {
        this.viewerComponent = await loadForgeViewerComponent(this.effectiveDiagramType);
        if (this.viewerComponent) {
          this.loading = false;
        } else {
          this.error = `Unknown diagram type: ${this.effectiveDiagramType}`;
          this.loading = false;
        }
      } else {
        this.loading = true;
        this.error = null;
      }
    }
  }
}
</script>

<style scoped>
.loading {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
  font-size: 16px;
  color: #666;
}

.error {
  display: flex;
  justify-content: center;
  align-items: center;
  height: 200px;
  font-size: 16px;
  color: #d32f2f;
}

.embed-container {
  width: 100%;
  height: 100%;
}
</style>
