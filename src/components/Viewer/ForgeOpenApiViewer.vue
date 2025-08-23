<template>
  <generic-viewer :hideHeader="hideHeader">
    <div id="swagger-ui-embed"></div>
  </generic-viewer>
</template>

<script>
import GenericViewer from "@/components/Viewer/GenericViewer.vue";
import SwaggerUIBundle from 'swagger-ui';
import "swagger-ui/dist/swagger-ui.css";
import SpecListener from '@/utils/spec-listener';
import OpenApiExample from '@/model/OpenApi/OpenApiExample';

export default {
  name: "ForgeOpenApiViewer",
  components: {
    GenericViewer
  },
  props: {
    doc: {
      type: Object,
      required: true
    },
    hideHeader: {
      type: Boolean,
      default: false
    }
  },
  mounted() {
    this.initSwaggerUi();
  },
  methods: {
    initSwaggerUi() {
      const elementId = 'swagger-ui-embed';
      const element = document.getElementById(elementId);
      if(element && element.innerHTML.trim()) {
        element.innerHTML = '';
      }

      const ui = SwaggerUIBundle({
        dom_id: `#${elementId}`,
        presets: [
          SwaggerUIBundle.presets.apis,
        ],
        plugins: [
          SwaggerUIBundle.plugins.DownloadUrl,
          SpecListener
        ],
      });

      // Update the spec with the document's code
      const spec = this.doc?.value?.code || this.doc?.code || OpenApiExample;
      ui.specActions.updateSpec(spec);
      
      // Store reference for potential future use
      window.ui = ui;
    }
  },
  watch: {
    doc: {
      handler(newDoc) {
        if (newDoc && window.ui) {
          const spec = newDoc?.value?.code || newDoc?.code || OpenApiExample;
          window.ui.specActions.updateSpec(spec);
        }
      },
      deep: true
    }
  }
}
</script> 