<template>
  <div id="forge-embed-viewer">
    <div v-if="loading" class="loading">
      Loading embedded diagram...
    </div>
    <div v-else-if="error" class="error">
      {{ error }}
    </div>
    <div v-else class="embed-container">
      <iframe 
        v-if="viewerUrl" 
        :src="viewerUrl" 
        style="width:100%;height:100%;border:0;"
        @load="onIframeLoad"
      ></iframe>
    </div>
  </div>
</template>

<script>
export default {
  name: "ForgeEmbedViewer",
  props: {
    diagramType: String
  },
  data() {
    return {
      loading: true,
      error: null,
      viewerUrl: null
    }
  },
  mounted() {
    this.initializeViewer();
  },
  methods: {
    getViewerUrl(diagramType) {
      if(diagramType === 'sequence' || diagramType === 'mermaid') {
        return '/sequence-viewer.html';
      }
      if(diagramType === 'graph') {
        return '/drawio/viewer.html';
      }
      if(diagramType === 'OpenAPI') {
        return '/swagger-ui.html';
      }
      return null;
    },
    initializeViewer() {
      if (this.diagramType) {
        const url = this.getViewerUrl(this.diagramType);
        if (url) {
          this.viewerUrl = `${url}${window.location.search}`;
        } else {
          this.error = `Unknown diagram type: ${this.diagramType}`;
        }
      } else {
        this.error = 'No diagram type specified';
      }
      this.loading = false;
    },
    onIframeLoad() {
      this.loading = false;
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