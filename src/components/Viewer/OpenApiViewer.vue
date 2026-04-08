<template>
<generic-viewer :wide="true" :hideHeader="hideHeader">
  <div id="swagger-ui"></div>
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
    // When doc is provided (embed context), initialize SwaggerUI directly.
    // When doc is null, forge-swagger-ui.ts handles initialization externally.
    if (this.doc !== null) {
      this.initWithDoc(this.doc);
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
  },
  methods: {
    initWithDoc(doc) {
      const element = document.getElementById('swagger-ui');
      if (element && element.innerHTML.trim()) {
        element.innerHTML = '';
      }
      const ui = SwaggerUIBundle({
        dom_id: '#swagger-ui',
        presets: [SwaggerUIBundle.presets.apis],
        plugins: [SwaggerUIBundle.plugins.DownloadUrl, SpecListener],
      });
      const spec = doc?.value?.code || doc?.code || OpenApiExample;
      ui.specActions.updateSpec(spec);
      window.ui = ui;
    }
  }
}
</script>
