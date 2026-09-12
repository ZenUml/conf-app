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
import { trackPublishBlocked } from '@/utils/analytics/publishIntent';
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
    let pendingTitle: Promise<string> | null = null;

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
    const currentTitle = computed<string>(() => (store.state.diagram?.title || "").trim());

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
      const title = value.trim();
      // Every keystroke, including clearing, cancels an older AI request.
      markManualEdit();
      if (title) {
        titleError.value = false;
      } else {
        onTitleCleared();
        scheduleAutoGenerate();
      }
      store.dispatch("updateTitle", value);
    };

    const handleTitleConfirm = () => {
      if (!pendingResolve) return;
      if (!currentTitle.value) {
        titleError.value = true;
        headerRef.value?.focusInput();
        return;
      }
      pendingResolve(currentTitle.value);
      pendingResolve = null;
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

    // A manual title is only accepted by Enter or a fresh Publish click.
    // Reuse one gate so repeated clicks cannot replace its pending resolver.
    const ensureTitle = (): Promise<string> => {
      if (pendingTitle) {
        const existing = pendingTitle;
        handleTitleConfirm();
        return existing;
      }
      if (currentTitle.value) return Promise.resolve(currentTitle.value);

      const gate = new Promise<string>((resolve) => {
        pendingResolve = (value) => {
          pendingTitle = null;
          resolve(value);
        };
      });
      pendingTitle = gate;
      void prepareMissingTitle();
      return gate;
    };

    async function prepareMissingTitle() {
      if (debounceTimer) clearTimeout(debounceTimer);
      const xml = (window as any).graphXml || props.currentXml || "";
      const code = extractGraphText(xml);
      if (aiTitleEnabled.value && code.trim() && !isGeneratingTitle.value) {
        await generate("user", {
          code,
          diagramType: DiagramType.Graph,
          currentTitle: "",
        });
      }
      // Generation may have been cancelled by typing. Only the AI-completed
      // edge below can accept its result; a nonempty manual title still waits.
      if (!pendingResolve || currentTitle.value) return;
      trackPublishBlocked('title_missing', {
        macroType: 'graph', operationMode: store.state.diagram.id ? 'edit' : 'create', titlePresent: false,
      });
      titleError.value = true;
      headerRef.value?.focusInput();
    }

    watch(currentTitle, (value) => {
      if (value) titleError.value = false;
    });

    // The composable commits the whole generated title before this edge.
    // Typing never creates this transition, including after an older AI title.
    watch(autoNameAnimationDone, (done) => {
      if (done) handleTitleConfirm();
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
