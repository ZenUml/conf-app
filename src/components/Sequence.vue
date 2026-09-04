<template>
  <ViewResizer v-if="autoResize">
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
import { trackViewerRenderCrash } from "@/utils/analytics/trackViewerRenderCrash";
import * as renderPerf from "@/utils/analytics/renderPerf";

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
    // Byline activation preview: when true, the render omits the ZenUML
    // onContentChange hook. Without this, clicking a participant name fires
    // updateCode → EventBus 'updateContent' → forgeIndex saveToPlatform
    // (canUserEdit() is a hardcoded `true`), so a "nothing has been saved"
    // preview would silently create custom content. Mermaid/PlantUml have no
    // such write-back seam and need no equivalent flag.
    readOnly: {
      type: Boolean,
      default: false
    }
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
      // Load ZenUml dynamically
      const ZenUml = await loadZenUml();
      zenuml = new ZenUml(this.$refs["zenuml"]);
      // Phase 0b: render_ms for the initial mount render (recorded once).
      await renderPerf.time('render', () => this.render());
      trackRenderTime('sequence', this.isDisplayMode);
      // The awaits above can span seconds (cold ZenUML chunk + render). If the
      // user switched diagram type meanwhile, emitting the sequence `code`
      // with the NEW store diagramType would upload a mislabeled attachment
      // (and for plantuml, fire a doomed PlantUML-server PNG fetch). The
      // component mounted for the new type emits its own diagramLoaded.
      if (this.$store.state.diagram.diagramType === DiagramType.Sequence) {
        EventBus.$emit(
          "diagramLoaded",
          this.$store.state.diagram.code,
          DiagramType.Sequence
        );
      }
    } catch (error) {
      console.error("Error loading ZenUML Core:", error);
      // reliability-audit-2026-08-06 §3/§12.1: this catch used to be
      // console.error-only — a chunk-load or zenuml.render() exception here
      // produced a blank macro with zero Mixpanel signal on either side.
      trackViewerRenderCrash('sequence', this.isDisplayMode, error);
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
        // readOnly preview (byline activation) must not write back — see the prop doc.
        ...(this.readOnly ? {} : { onContentChange: this.updateCode }),
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
    }
  },
  watch: {
    // watch in general is not a good idea, but it seems that this is the only native way to trigger reactivity.
    // another way would be use the https://www.npmjs.com/package/vue-async-computed
    async code() {
      if (!this.code) return;
      try {
        await this.render();
      } catch (error) {
        // reliability-audit-2026-08-06 §3/§12.1: this re-render path (every
        // content update after the first mount) previously had no try/catch
        // at all — a zenuml.render() exception here was an unhandled promise
        // rejection with zero telemetry of any kind.
        console.error("Error re-rendering ZenUML:", error);
        trackViewerRenderCrash('sequence', this.isDisplayMode, error);
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
