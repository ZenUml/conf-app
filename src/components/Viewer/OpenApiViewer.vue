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
import * as renderPerf from '@/utils/analytics/renderPerf';

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
    // render_ms is measured around the REAL swagger-ui render (updateSpecFromDiagram),
    // which settles on swagger-ui's own onComplete hook — not at mount, which fires
    // before any spec is rendered. _tracked makes the macro_viewed emit single-shot.
    this._tracked = false;
    this._resolveRenderSettle = null;
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
        // swagger-ui fires onComplete after it commits the spec render — our
        // render_ms settle signal (this slot is otherwise unused). Single-shot.
        onComplete: () => {
          const resolve = this._resolveRenderSettle;
          this._resolveRenderSettle = null;
          if (resolve) resolve();
        },
      });
      window.ui = ui;
    },
    async updateSpecFromDiagram() {
      if (!window.ui) return;
      const doc = this.effectiveDoc;
      const userCode = doc?.value?.code || doc?.code;
      // Placeholder/example fallback (no real spec yet, e.g. the NULL_DIAGRAM mount):
      // render it but DON'T measure — render_ms must reflect a real user spec.
      if (!userCode) {
        window.ui.specActions.updateSpec(OpenApiExample);
        return;
      }
      // Time the real render from updateSpec until swagger-ui's onComplete settle
      // (with a defensive timeout so analytics never silently drop). renderPerf
      // records the first resolution; _tracked makes the macro_viewed emit once.
      await renderPerf.time('render', async () => {
        const settled = this.awaitNextSettle();
        window.ui.specActions.updateSpec(userCode);
        await Promise.race([settled, this._settleTimeout()]);
      });
      if (!this._tracked) {
        this._tracked = true;
        trackRenderTime('openapi', this.$store.getters.isDisplayMode);
      }
    },
    awaitNextSettle() {
      return new Promise((resolve) => {
        this._resolveRenderSettle = resolve;
      });
    },
    _settleTimeout() {
      // Defense-in-depth: a malformed spec that never fires onComplete still
      // resolves render_ms + emits macro_viewed.
      return new Promise((resolve) => setTimeout(resolve, 8000));
    }
  }
}
</script>
