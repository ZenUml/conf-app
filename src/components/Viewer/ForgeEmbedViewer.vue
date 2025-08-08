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
        :doc="doc"
        :graphXml="doc?.graphXml"
        :code="doc?.code"
        :mermaidCode="doc?.mermaidCode"
      />
    </div>
  </div>
</template>

<script>
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
  methods: {
    async loadViewerComponent(diagramType) {
      try {
        if(diagramType === 'sequence' || diagramType === 'mermaid') {
          // Import sequence viewer components
          const { default: DiagramPortal } = await import('@/components/DiagramPortal.vue');
          return DiagramPortal;
        }
        if(diagramType === 'graph') {
          // Import graph viewer component
          const { default: ForgeGraphViewer } = await import('@/components/Viewer/ForgeGraphViewer.vue');
          return ForgeGraphViewer;
        }
        if(diagramType === 'OpenAPI') {
          // Import Forge-specific OpenAPI viewer component
          const { default: ForgeOpenApiViewer } = await import('@/components/Viewer/ForgeOpenApiViewer.vue');
          return ForgeOpenApiViewer;
        }
        return null;
      } catch (e) {
        console.error('Failed to load viewer component for type:', diagramType, e);
        return null;
      }
    },
    async initializeViewer() {
      if (this.diagramType) {
        this.viewerComponent = await this.loadViewerComponent(this.diagramType);
        if (this.viewerComponent) {
          this.loading = false;
        } else {
          this.error = `Unknown diagram type: ${this.diagramType}`;
          this.loading = false;
        }
      } else {
        this.error = 'No diagram type specified';
        this.loading = false;
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