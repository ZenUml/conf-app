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
import { DiagramType } from "@/model/Diagram/Diagram";

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
      const type = this.effectiveDiagramType;

      // The viewer mounts on NULL_DIAGRAM (diagramType 'unknown') BEFORE the
      // async loadDiagram() publishes the referenced doc into the store — the
      // effectiveDiagramType watcher re-runs this once the real type arrives.
      // Treat the transient 'unknown'/empty as "still loading", never a hard
      // error: the old code set `error` from this initial pass and left it set,
      // so even after a valid doc loaded (e.g. plantuml) the stale
      // "Unknown diagram type: unknown" masked the resolved viewer.
      if (!type || type === DiagramType.Unknown) {
        this.loading = true;
        this.error = null;
        return;
      }

      const component = await loadForgeViewerComponent(type);
      this.loading = false;
      if (component) {
        this.viewerComponent = component;
        this.error = null; // clear any error left over from the initial pass
      } else {
        // A genuinely-resolved but unrenderable type (e.g. an embed pointing at
        // another embed) — this is a real error, not the transient state.
        this.error = `Unknown diagram type: ${type}`;
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
