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
import { viewerRenderReporterKey } from '@/utils/viewerRenderReporter';

export default {
  name: "ForgeEmbedViewer",
  inject: {
    viewerRenderReporter: {
      from: viewerRenderReporterKey,
      default: null,
    },
  },
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
    },
    viewerLoadStatus() {
      // Prop-driven editor previews already have content. Plain Embed viewers
      // use the lifecycle's explicit state instead of inferring completion from
      // NULL_DIAGRAM plus a separate boolean.
      return this.doc ? 'rendered' : this.$store.state.viewerLoadState?.status ?? 'loading';
    },
    loadComplete() {
      return this.viewerLoadStatus !== 'loading';
    }
  },
  watch: {
    effectiveDiagramType() {
      this.initializeViewer();
    },
    // Empty/failed loads can leave diagramType='unknown', so status is the
    // signal that terminates the spinner even when the document never changes.
    viewerLoadStatus() {
      this.initializeViewer();
    }
  },
  methods: {
    async initializeViewer() {
      const type = this.effectiveDiagramType;

      // The viewer mounts on NULL_DIAGRAM (diagramType 'unknown') BEFORE the
      // async loadDiagram() publishes the referenced doc into the store — the
      // watchers re-run this once the real type arrives (success) or the load
      // completes with nothing renderable (failure).
      const component = type && type !== DiagramType.Unknown
        ? await loadForgeViewerComponent(type)
        : null;

      if (component) {
        // Renderable type resolved — clear any transient state and show it.
        this.viewerComponent = component;
        this.error = null;
        this.loading = false;
        return;
      }

      if (this.loadComplete) {
        // Load finished but there's nothing to render: either the referenced
        // content is missing/deleted (NULL_DIAGRAM 'unknown' — the 404 case) or
        // it resolved to an unsupported type (e.g. an embed pointing at another
        // embed). Surface a terminal error rather than spinning forever.
        this.error = type && type !== DiagramType.Unknown
          ? `Unknown diagram type: ${type}`
          : "This embedded diagram couldn't be loaded. It may have been deleted or moved, or it's a draft or in a space you can't access. Edit the macro to pick a different diagram.";
        this.loading = false;
        const revision = this.viewerRenderReporter?.captureRevision() ?? 0;
        if (revision > 0) {
          this.viewerRenderReporter.failed(revision, new Error(this.error));
        }
        return;
      }

      // Still loading the referenced doc.
      this.loading = true;
      this.error = null;
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
