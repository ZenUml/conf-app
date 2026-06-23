<template>
  <!-- Display-mode static SVG (renderToSvg, no React mount); themed/editor paths use ref="zenuml" -->
  <div v-if="usedSyncPath" class="flex justify-center" v-html="staticSvg"></div>
  <ViewResizer v-else-if="autoResize">
    <template #default>
      <div ref="zenuml" class="resize-target"></div>
    </template>
  </ViewResizer>
  <div v-else ref="zenuml"></div>
</template>

<script>
// Import ZenUml dynamically instead of statically
// import ZenUml from "@zenuml/core";
import EventBus from "@/EventBus";
import { DiagramType } from "@/model/Diagram/Diagram";
import { trackEvent } from "@/utils/window";
import globals from "@/model/globals";
import ViewResizer from "./Viewer/ViewResizer.vue";
import { trackRenderTime } from "@/utils/analytics/trackRenderTime";
import * as renderPerf from "@/utils/analytics/renderPerf";
import { sanitizeSvg } from "@/utils/mermaid/sanitizeSvg";

// Create a promise to load ZenUml only when needed
const loadZenUml = () => import("@zenuml/core").then(module => module.default);

let zenuml;
const getThemeStorageKey = (id) => {
  if (id === "global") {
    return `${location.hostname}-zenuml-conf-theme`;
  }
  return id
    ? `${location.hostname}-${id}-zenuml-conf-theme`
    : `${location.hostname}-preserve-zenuml-conf-theme`;
};
export default {
  name: "Sequence",
  components: { ViewResizer },
  props: {
    autoResize: {
      type: Boolean,
      default: false
    },
    // When wrapped by the embed host, suppress this viewer's own macro_viewed.
    embedded: { type: Boolean, default: false },
  },
  data() {
    return {
      staticSvg: null,
      usedSyncPath: false,
    };
  },
  computed: {
    code() {
      return (
        this.$store.state.diagram.diagramType === DiagramType.Sequence &&
        this.$store.state.diagram.code
      );
    },
    isDisplayMode() {
      return this.$store.getters.isDisplayMode;
    },
  },
  async mounted() {
    try {
      const code = this.$store.state.diagram.code;
      // Display-mode + default-theme fast path. Two tiers, both skipping the React mount:
      //   1. Lever D (cached_svg): a pre-rendered SVG in the CC body — inject it and skip
      //      the @zenuml/core bundle ENTIRELY (no loadZenUml, no resource_load). The real
      //      50% cut; only present for macros saved after Lever D shipped.
      //   2. sync_svg: no cached SVG (back-catalog) — render to a static SVG at view via
      //      @zenuml/core's synchronous renderToSvg(). Still loads the bundle, but skips
      //      the React mount.
      // Themed or editable macros fall through to the interactive ZenUml render below
      // (renderToSvg ignores theme in v3.47.5; interactivity is editor-only anyway).
      if (this.canUseSyncSvg()) {
        if (await this.tryInjectCachedSvg()) {
          if (!this.embedded) trackRenderTime('sequence', this.isDisplayMode, 'cached_svg', 'cc_body');
          this.$emit('rendered');
          EventBus.$emit("diagramLoaded", code, this.$store.state.diagram.diagramType);
          return;
        }
        if (await this.tryRenderSyncSvg(code)) {
          if (!this.embedded) trackRenderTime('sequence', this.isDisplayMode, 'sync_svg', 'none');
          this.$emit('rendered');
          EventBus.$emit("diagramLoaded", code, this.$store.state.diagram.diagramType);
          return;
        }
      }
      // Load ZenUml dynamically (interactive React render)
      const ZenUml = await renderPerf.time('resource', () => loadZenUml());
      console.log("ZenUML Core version: ", ZenUml.version);
      zenuml = new ZenUml(this.$refs["zenuml"]);
      // Phase 0b: render_ms for the initial mount render (recorded once).
      await renderPerf.time('render', () => this.render());
      if (!this.embedded) trackRenderTime('sequence', this.isDisplayMode, 'live_render', 'none');
      this.$emit('rendered');
      EventBus.$emit(
        "diagramLoaded",
        this.$store.state.diagram.code,
        this.$store.state.diagram.diagramType
      );
    } catch (error) {
      console.error("Error loading ZenUML Core:", error);
    }
  },
  methods: {
    async render() {
      if (!zenuml) {
        console.warn("ZenUML instance not initialized yet");
        return;
      }

      const id = this.$store.state.diagram.id;
      const globalTheme = localStorage.getItem(getThemeStorageKey("global"));
      const scopeTheme = id
        ? localStorage.getItem(getThemeStorageKey(id))
        : sessionStorage.getItem(getThemeStorageKey());
      await zenuml.render(this.$store.state.diagram.code, {
        // stickyOffset is used only at view mode or edit when the iframe scroll out of the viewport
        // In fullscreen viewer or editor mode, the iFrame element is not scrollable, so we don't need to offset.
        // Note when the iframe is not scrollable, the stickyOffset does not have any effect.
        theme: scopeTheme || globalTheme || "theme-default",
        enableScopedTheming: Boolean(scopeTheme),
        stickyOffset: false,  // disable sticky offset, the effect is not optimal
        onContentChange: this.updateCode,
        onThemeChange: ({ theme, scoped }) => {
          if (!scoped) {
            trackEvent("set_theme_global", "click", DiagramType.Sequence);
            localStorage.setItem(getThemeStorageKey("global"), theme);
            localStorage.setItem(getThemeStorageKey(id), "");
            return;
          }
          trackEvent("set_theme_scoped", "click", DiagramType.Sequence);
          // there will not be an id when the diagram is just created
          if (id) {
            localStorage.setItem(getThemeStorageKey(id), theme);
          } else {
            sessionStorage.setItem(getThemeStorageKey(), theme);
          }
        },
        onEventEmit: (event,data) =>{
          if(event === 'trackEvent'){
            trackEvent(data.label, data.action, data.category);
          }
        }
      });
    },
    updateCode(newCode) {
      this.$store.dispatch("updateCode2", newCode);
      EventBus.$emit("updateContent", this.$store.state.diagram);
    },
    canUseSyncSvg() {
      // Only the read-only viewer with the default theme can use the static SVG:
      // renderToSvg ignores the theme option, and editor interactivity needs React.
      if (!this.isDisplayMode) return false;
      const id = this.$store.state.diagram.id;
      const globalTheme = localStorage.getItem(getThemeStorageKey("global"));
      const scopeTheme = id
        ? localStorage.getItem(getThemeStorageKey(id))
        : sessionStorage.getItem(getThemeStorageKey());
      return !scopeTheme && (!globalTheme || globalTheme === "theme-default");
    },
    async tryInjectCachedSvg() {
      // Lever D read path: inject the SVG rendered at save (Persistence.maybeAttachSequenceSvg),
      // skipping the @zenuml/core bundle altogether. render_ms = the cheap sanitize scrub;
      // resource_load_ms is absent (no import). Sanitized on read (stored-XSS guard, mirrors
      // Mermaid.vue). Returns false when no cached SVG or the scrub rejects it.
      const cached = this.$store.state.diagram.sequenceSvg;
      if (!cached) return false;
      const safe = await renderPerf.time('render', async () => sanitizeSvg(cached));
      if (!safe) return false;
      this.staticSvg = safe;
      this.usedSyncPath = true;
      return true;
    },
    async tryRenderSyncSvg(code) {
      // resource_load_ms is still measured honestly (same ~2.4MB @zenuml/core bundle —
      // the sync path saves the React mount, NOT the bundle). render_ms wraps renderToSvg.
      let result;
      try {
        const mod = await renderPerf.time('resource', () => import("@zenuml/core"));
        if (typeof mod.renderToSvg !== "function") return false;
        result = await renderPerf.time('render', async () => mod.renderToSvg(code));
      } catch (e) {
        console.warn("renderToSvg failed; falling back to interactive render", e);
        return false;
      }
      const safe = sanitizeSvg(result && result.svg);
      if (!safe) return false;
      this.staticSvg = safe;
      this.usedSyncPath = true;
      return true;
    }
  },
  watch: {
    // watch in general is not a good idea, but it seems that this is the only native way to trigger reactivity.
    // another way would be use the https://www.npmjs.com/package/vue-async-computed
    async code() {
      if (!this.code) return;
      if (this.usedSyncPath) {
        await this.tryRenderSyncSvg(this.code);
      } else {
        await this.render();
      }
    },
  },
};
</script>

<style>
#headlessui-portal-root {
  position: relative;
  z-index: 11;
}

.zenuml {
  overflow: hidden;
}
</style>
