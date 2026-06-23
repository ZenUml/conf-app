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
        :embedded="true"
        @rendered="onWrappedRendered"
      />
    </div>
  </div>
</template>

<script>
import { loadForgeViewerComponent } from "@/model/Diagram/DiagramTypeConfig";
import { DiagramType } from "@/model/Diagram/Diagram";
import { trackRenderTime } from "@/utils/analytics/trackRenderTime";

const DIAGRAM_TYPE_TO_MACRO_TYPE = {
  [DiagramType.Sequence]: 'sequence',
  [DiagramType.Mermaid]: 'mermaid',
  [DiagramType.PlantUml]: 'plantuml',
  [DiagramType.Graph]: 'graph',
  [DiagramType.OpenApi]: 'openapi',
};

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
      viewerComponent: null,
      emitted: false
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
    wrappedType() {
      return DIAGRAM_TYPE_TO_MACRO_TYPE[this.effectiveDiagramType] || 'none';
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
          // Unknown type renders nothing — still record one embed view so the macro
          // is observable in Mixpanel instead of silently invisible.
          this.emitEmbedOnce('none');
        }
      } else {
        this.loading = true;
        this.error = null;
      }
    },
    // The embed host owns the single macro_viewed (macro_type='embed', wrapped_type=
    // <inner>); the wrapped child suppresses its own emit via :embedded. render_ms +
    // sub-timings come from the wrapped viewer's renderPerf.time('render').
    onWrappedRendered() {
      this.emitEmbedOnce(this.wrappedType);
    },
    emitEmbedOnce(wrappedType) {
      if (this.emitted) return;
      this.emitted = true;
      trackRenderTime('embed', this.$store.getters.isDisplayMode, 'live_render', 'none', wrappedType);
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
