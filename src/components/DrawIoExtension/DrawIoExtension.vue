<template>
  <DrawIoHeader
    ref="headerRef"
    :title="currentTitle"
    :error="titleError"
    :ai-title-available="aiTitleEnabled"
    :is-generating-title="isGeneratingTitle"
    :is-animating="isAnimating"
    :displayed-title="displayedTitle"
    :show-spark="showSpark"
    :spark-fading-out="sparkFadingOut"
    :show-dismiss="showDismiss"
    :auto-name-animation-done="autoNameAnimationDone"
    :editor-mode="editorMode"
    @titleChange="handleTitleChange"
    @titleConfirm="handleTitleConfirm"
    @manualGenerate="onManualGenerate"
    @dismiss="onDismiss"
  />
</template>

<script lang="ts">
import { defineComponent, computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import DrawIoHeader from "./components/DrawIoHeader.vue";
import store from "@/model/store2";
import { DiagramType } from "@/model/Diagram/Diagram";
import { extractGraphText } from "@/utils/graph/extractGraphText";
import { useAutoTitle } from "@/composables/useAutoTitle";

const AUTO_DEBOUNCE_MS = 1500;

export default defineComponent({
  components: {
    DrawIoHeader
  },
  props: {
    doc: {
      type: Object
    },
    // Live mxGraph XML from the DrawIO iframe (ForgeGraphEditor forwards its
    // latest autosave xml here). Drives the AI auto-title watcher.
    currentXml: {
      type: String,
      default: ""
    },
    editorMode: {
      type: String,
      default: "diagram"
    }
  },
  setup(props) {
    const titleError = ref(false);
    const headerRef = ref<InstanceType<typeof DrawIoHeader>>();
    let pendingResolve: ((value: string) => void) | null = null;

    const {
      aiTitleEnabled, isGeneratingTitle, isAnimating, displayedTitle,
      showSpark, sparkFadingOut, showDismiss, autoNameAnimationDone,
      generate, dismiss, markManualEdit, onTitleCleared, reset,
    } = useAutoTitle();

    // Single source of truth for the graph title is the Vuex store. Because the
    // graph editor sets `store.state.diagram === window.diagram` (same object),
    // dispatching `updateTitle` keeps `window.diagram.title` synced for the
    // save path (saveGraphAndExit spreads window.diagram) AND for
    // `window.ensureTitle` below.
    const currentTitle = computed<string>(() => store.state.diagram?.title || "");

    // The extracted shape labels are the "code" fed to the title model — clean
    // signal instead of raw mxfile XML.
    const graphCode = computed<string>(() => extractGraphText(props.currentXml));

    let debounceTimer: ReturnType<typeof setTimeout> | undefined;

    function scheduleAutoGenerate() {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        generate("init", {
          code: graphCode.value,
          diagramType: DiagramType.Graph,
          currentTitle: currentTitle.value,
        });
      }, AUTO_DEBOUNCE_MS);
    }

    const handleTitleChange = (value: string) => {
      if (value) {
        titleError.value = false;
        markManualEdit();
      } else {
        onTitleCleared();
        scheduleAutoGenerate();
      }
      store.dispatch("updateTitle", value);
      if (value && pendingResolve) {
        pendingResolve(value);
        pendingResolve = null;
      }
    };

    const handleTitleConfirm = () => {
      if (currentTitle.value && pendingResolve) {
        pendingResolve(currentTitle.value);
        pendingResolve = null;
      }
    };

    const onManualGenerate = () => {
      generate("user", {
        code: graphCode.value,
        diagramType: DiagramType.Graph,
        currentTitle: currentTitle.value,
      });
    };

    const onDismiss = () => {
      dismiss();
    };

    // Publish gate (ForgeGraphEditor calls window.ensureTitle() before save).
    const ensureTitle = async (): Promise<string> => {
      if (currentTitle.value) {
        return currentTitle.value;
      }

      // The title is still empty at publish. Rather than depending on the
      // debounced while-editing watcher (which may not have fired yet if the
      // user published right after their last edit), generate on demand from
      // the diagram content that's being saved right now. The save handler in
      // ForgeGraphEditor sets window.graphXml = payload.xml immediately before
      // calling this, so it is the freshest, most complete source.
      if (debounceTimer) clearTimeout(debounceTimer);
      const xml = (window as any).graphXml || props.currentXml || "";
      const code = extractGraphText(xml);
      if (aiTitleEnabled.value && code.trim() && !isGeneratingTitle.value) {
        await generate("user", {
          code,
          diagramType: DiagramType.Graph,
          currentTitle: "",
        });
        if (currentTitle.value) return currentTitle.value;
      }

      // No content to title yet (e.g. unlabelled shapes), generation failed, or
      // a generation is still in flight — surface the error, focus the input,
      // and wait. The currentTitle watcher below resolves this promise if an
      // in-flight generation lands a title, so publish can still proceed
      // automatically without the user typing.
      titleError.value = true;
      headerRef.value?.focusInput();
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    };

    // A committed AI title (or any late title change) should release a pending
    // ensureTitle() the publish flow is blocked on.
    watch(currentTitle, (value) => {
      if (value && pendingResolve) {
        pendingResolve(value);
        pendingResolve = null;
      }
    });

    watch(graphCode, () => scheduleAutoGenerate());

    onMounted(() => {
      reset(); // clear any per-document state left over from a previous editor session
      window.ensureTitle = ensureTitle;
      // Existing untitled graphs already have labelled content at mount, so the
      // graphCode watcher won't fire on its own — kick off an initial attempt.
      scheduleAutoGenerate();
    });

    onBeforeUnmount(() => {
      if (debounceTimer) clearTimeout(debounceTimer);
    });

    return {
      currentTitle,
      titleError,
      headerRef,
      aiTitleEnabled,
      isGeneratingTitle,
      isAnimating,
      displayedTitle,
      showSpark,
      sparkFadingOut,
      showDismiss,
      autoNameAnimationDone,
      handleTitleChange,
      handleTitleConfirm,
      onManualGenerate,
      onDismiss
    };
  }
});
</script>

<style scoped></style>
