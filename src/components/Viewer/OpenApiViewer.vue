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
import { trackViewerRenderCrash } from '@/utils/analytics/trackViewerRenderCrash';

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
  data() {
    return { renderReported: false };
  },
  mounted() {
    this.initSwaggerUi();
    this.updateSpecFromDiagram();
    this.reportRenderOnce();
  },
  watch: {
    doc: {
      handler() {
        this.updateSpecFromDiagram();
        this.reportRenderOnce();
      },
      deep: true
    },
    storeDiagram: {
      handler() {
        this.updateSpecFromDiagram();
      },
      deep: true
    },
    loadComplete() {
      this.reportRenderOnce();
    }
  },
  computed: {
    storeDiagram() {
      return this.$store.state.diagram;
    },
    loadComplete() {
      return this.$store.state.diagramLoadComplete === true;
    },
    effectiveDoc() {
      return this.doc ?? this.storeDiagram;
    }
  },
  methods: {
    // #413: the OpenAPI entry mounts this component BEFORE its content load
    // resolves (utils/viewerBootstrap.ts mounts a NULL_DIAGRAM shell first), so
    // reporting from mounted() timed an empty skeleton and snapshotted
    // renderPerf before a single fetch phase had been recorded — from
    // v2026.07.250749 openapi shipped no fetch_ms, custom_content_fetch_ms or
    // page_adf_fetch_ms at all, and its duration_ms silently stopped covering
    // the content load. Report once the content has settled instead.
    //
    // `diagramLoadComplete` flips on failure as well as success, so a macro
    // whose content 404s still reports (macro_viewed is a readership metric —
    // it must not become success-only). A `doc` prop means the content was
    // already in hand at mount (embed host, editor preview): nothing to wait for.
    reportRenderOnce() {
      if (this.renderReported) return;
      if (!this.loadComplete && !this.doc) return;
      this.renderReported = true;
      // SwaggerUI renders asynchronously internally — this measures
      // time-to-content, not time-to-full-paint. Best approximation available
      // without a render callback.
      trackRenderTime('openapi', this.$store.getters.isDisplayMode);
    },
    // reliability-audit-2026-08-06 §4/§12.2 (conf-app#149/#150): this file had
    // no error handling at all — a SwaggerUIBundle/updateSpec exception threw
    // straight out of the mounted() lifecycle hook with zero Mixpanel signal.
    // Caught locally (not left to propagate) so a crash here can't also break
    // reportRenderOnce()'s call further down mounted().
    initSwaggerUi() {
      const element = this.$refs.swaggerUi;
      if (element && element.innerHTML.trim()) {
        element.innerHTML = '';
      }
      try {
        const ui = SwaggerUIBundle({
          dom_id: '#swagger-ui',
          presets: [SwaggerUIBundle.presets.apis],
          plugins: [SwaggerUIBundle.plugins.DownloadUrl, SpecListener],
        });
        window.ui = ui;
      } catch (e) {
        console.error('OpenApiViewer: SwaggerUI init failed:', e);
        trackViewerRenderCrash('openapi', this.$store.getters.isDisplayMode, e);
      }
    },
    updateSpecFromDiagram() {
      if (!window.ui) return;
      const doc = this.effectiveDoc;
      const spec = doc?.value?.code || doc?.code || OpenApiExample;
      try {
        window.ui.specActions.updateSpec(spec);
      } catch (e) {
        console.error('OpenApiViewer: updateSpec failed:', e);
        trackViewerRenderCrash('openapi', this.$store.getters.isDisplayMode, e);
      }
    }
  }
}
</script>
