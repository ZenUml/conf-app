<template>
  <ViewResizer v-if="useViewResizer">
    <template>
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
import ViewResizer from "./ViewResizer.vue";

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
    useViewResizer: {
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
  },
  async mounted() {
    try {
      // Load ZenUml dynamically
      const ZenUml = await loadZenUml();
      console.log("ZenUML Core version: ", ZenUml.version);
      zenuml = new ZenUml(this.$refs["zenuml"]);
      await this.render();
      // Track the view event here, after the diagram is rendered
      const macroData = await globals.apWrapper.getMacroData();
      trackEvent(macroData?.uuid, 'view_macro', 'sequence');
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
        stickyOffset: 120,
        onContentChange: this.updateCode,
        onThemeChange: ({ theme, scoped }) => {
          if (!scoped) {
            trackEvent("set_theme_global", "click", "sequence");
            localStorage.setItem(getThemeStorageKey("global"), theme);
            localStorage.setItem(getThemeStorageKey(id), "");
            return;
          }
          trackEvent("set_theme_scoped", "click", "sequence");
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
      await this.render();
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
