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
import { trackRenderTime } from '@/utils/analytics/trackRenderTime';
import { viewerRenderReporterKey } from '@/utils/viewerRenderReporter';

export default {
  name: "OpenApiViewer",
  components: { GenericViewer },
  inject: {
    viewerRenderReporter: {
      from: viewerRenderReporterKey,
      default: null,
    },
  },
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
  data() {
    return { renderReported: false };
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
    // Compatibility Adapter for editor/embed previews that mount this renderer
    // with a doc prop but without a plain-viewer lifecycle session.
    reportRenderOnce() {
      if (this.viewerRenderReporter) return;
      if (this.renderReported) return;
      if (!this.doc) return;
      this.renderReported = true;
      // SwaggerUI renders asynchronously internally — this measures
      // time-to-content, not time-to-full-paint. Best approximation available
      // without a render callback.
      trackRenderTime('openapi', this.$store.getters.isDisplayMode);
    },
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
      const revision = this.viewerRenderReporter?.captureRevision() ?? 0;
      try {
        window.ui.specActions.updateSpec(spec);
        if (this.viewerRenderReporter && revision > 0) {
          this.viewerRenderReporter.rendered(revision);
        } else {
          this.reportRenderOnce();
        }
      } catch (error) {
        if (this.viewerRenderReporter) {
          this.viewerRenderReporter.failed(revision, error);
          return;
        }
        throw error;
      }
    }
  }
}
</script>
