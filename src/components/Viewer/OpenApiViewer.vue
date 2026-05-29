<template>
<generic-viewer :wide="true" :hideHeader="hideHeader">
  <div id="swagger-ui" ref="swaggerUi"></div>
</generic-viewer>
</template>

<script>
import GenericViewer from "@/components/Viewer/GenericViewer.vue";
import SwaggerUIBundle from 'swagger-ui';
import "swagger-ui/dist/swagger-ui.css";
import SpecListener from '@/utils/spec-listener';
import OpenApiExample from '@/model/OpenApi/OpenApiExample';

export default {
  name: "OpenApiViewer",
  components: { GenericViewer },
  props: {
    doc: {
      type: Object,
      default: null
    },
    hideHeader: {
      type: Boolean,
      default: false
    }
  },
  mounted() {
    this.initSwaggerUi();
    this.updateSpecFromDiagram();
  },
  watch: {
    doc: {
      handler() {
        this.updateSpecFromDiagram();
      },
      deep: true
    },
    storeDiagram: {
      handler() {
        this.updateSpecFromDiagram();
      },
      deep: true
    }
  },
  computed: {
    storeDiagram() {
      return this.$store.state.diagram;
    },
    effectiveDoc() {
      return this.doc ?? this.storeDiagram;
    }
  },
  methods: {
    initSwaggerUi() {
      const element = this.$refs.swaggerUi;
      if (element && element.innerHTML.trim()) {
        element.innerHTML = '';
      }
      const ui = SwaggerUIBundle({
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis],
        plugins: [SwaggerUIBundle.plugins.DownloadUrl, SpecListener],
      });
      window.ui = ui;
    },
    updateSpecFromDiagram() {
      if (!window.ui) return;
      const doc = this.effectiveDoc;
      const spec = doc?.value?.code || doc?.code || OpenApiExample;
      window.ui.specActions.updateSpec(spec);
    }
  }
}
</script>
