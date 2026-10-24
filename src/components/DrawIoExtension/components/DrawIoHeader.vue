<template>
  <!-- Compact overlay anchored on DrawIO's menubar row, right-aligned.
       Save & Exit / fullscreen / sidebar buttons sit on row 2 below, so
       the menubar row's right side is empty — title can hug the edge. -->
  <div
    class="drawio-header absolute top-[1px] right-[12px] z-50 pointer-events-auto"
    :class="{ 'drawio-header--board': editorMode === 'board' }"
    :style="editorMode === 'board' ? { right: '164px' } : undefined"
    :data-editor-mode="editorMode"
  >
    <div class="flex items-center w-72 max-w-md border rounded-md transition-colors duration-200 h-7 bg-white"
      :class="error ? 'border-red-400 bg-red-50' : 'border-gray-300 hover:border-gray-400 focus-within:border-blue-500'">
      <span class="pl-3 pr-2 text-[10px] font-semibold tracking-wide text-gray-400 uppercase select-none flex-shrink-0">Title</span>
      <div class="w-px h-3 bg-gray-200 flex-shrink-0"></div>

      <button v-if="aiTitleAvailable || autoNameAnimationDone" type="button"
        class="ml-0.5 rounded p-0.5 flex-shrink-0 text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors duration-200"
        :class="[
          (isGeneratingTitle || showSpark) && !sparkFadingOut ? 'autoname-spark-in text-purple-500' : '',
          sparkFadingOut ? 'autoname-spark-out' : '',
        ]"
        title="Generate title with AI" :disabled="isGeneratingTitle || isAnimating" @click="$emit('manualGenerate')">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 0 0-2.456 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
        </svg>
      </button>

      <input
        type="text"
        placeholder="Name your graph…"
        :value="displayValue"
        @input="handleInput"
        @keydown.enter="$emit('titleConfirm')"
        :readonly="isAnimating"
        ref="inputRef"
        class="flex-1 px-2 py-0 bg-transparent outline-none text-xs min-w-0"
        :class="[error ? 'text-red-700 placeholder-red-300' : '', isAnimating ? 'autoname-typing' : '']" />

      <button v-if="showDismiss" type="button" class="autoname-dismiss flex items-center justify-center flex-shrink-0 mr-1"
        title="Dismiss suggested title" @click="$emit('dismiss')">
        <IconDismiss />
      </button>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent, computed, ref } from "vue";
import IconDismiss from "@/components/icons/IconDismiss.vue";

export default defineComponent({
  components: { IconDismiss },
  props: {
    title: { type: String, default: "" },
    error: { type: Boolean, default: false },
    // AI auto-title state (mirrors DiagramTitleInput.vue). The parent
    // (DrawIoExtension) owns the useAutoTitle composable and passes state down;
    // this stays a thin presentation component that emits user intents.
    aiTitleAvailable: { type: Boolean, default: true },
    isGeneratingTitle: { type: Boolean, default: false },
    isAnimating: { type: Boolean, default: false },
    displayedTitle: { type: String, default: "" },
    showSpark: { type: Boolean, default: false },
    sparkFadingOut: { type: Boolean, default: false },
    showDismiss: { type: Boolean, default: false },
    autoNameAnimationDone: { type: Boolean, default: false },
    editorMode: { type: String, default: 'diagram' },
  },
  emits: ["titleChange", "titleConfirm", "manualGenerate", "dismiss"],
  setup(props, { emit }) {
    const inputRef = ref<HTMLInputElement>();

    // While the typewriter animation runs, show the progressively-typed title
    // (driven by the composable) rather than the committed store value.
    const displayValue = computed(() =>
      props.isAnimating ? props.displayedTitle : props.title
    );

    const handleInput = (event: Event) => {
      const value = (event.target as HTMLInputElement).value;
      emit("titleChange", value);
    };

    const focusInput = () => {
      inputRef.value?.focus();
    };

    return {
      inputRef,
      displayValue,
      handleInput,
      focusInput,
    };
  },
});
</script>

<style scoped>
@keyframes autoname-spark-fadein { from { opacity: 0; transform: scale(0.5); } to { opacity: 1; transform: scale(1); } }
@keyframes autoname-spark-fadeout { from { opacity: 1; transform: scale(1); } to { opacity: 0; transform: scale(0.6); } }
/* Gentle twinkle while a title is being generated/typed, so the spark reads as "working". */
@keyframes autoname-spark-pulse { 0%, 100% { transform: scale(1); opacity: 0.8; } 50% { transform: scale(1.2); opacity: 1; } }
/* Fade in once, then pulse continuously until the spark fades out in Phase 3. */
.autoname-spark-in { animation: autoname-spark-fadein 300ms ease-out, autoname-spark-pulse 1.1s ease-in-out 300ms infinite; }
.autoname-spark-out { animation: autoname-spark-fadeout 400ms ease-in forwards; }

@keyframes autoname-blink { 0%, 100% { border-right-color: #7C3AED; } 50% { border-right-color: transparent; } }
.autoname-typing { border-right: 2px solid #7C3AED; animation: autoname-blink 0.8s step-end infinite; }

.autoname-dismiss { width: 18px; height: 18px; border-radius: 4px; background: transparent; color: #42526E; }
.autoname-dismiss:hover { background: #EBECF0; color: #172B4D; }

/* Sketch chrome puts Publish in the top-right toolbar. Leave both its width and
   a small gap clear; Diagram mode keeps the existing right-aligned placement. */
.drawio-header--board {
  /* The Sketch toolbar keeps its native action group at the top-right. Its
     measured 152px width plus the 12px viewport inset must stay clickable;
     the previous 96px offset left the title over Publish/Format by ~60px. */
  right: 164px;
  width: min(18rem, calc(100vw - 176px));
  max-width: calc(100vw - 176px);
}

.drawio-header--board > div {
  /* Keep the title field inside the responsive outer box on narrow editors;
     Tailwind's fixed w-72 must not force it back over native actions. */
  width: 100%;
}

/* At compact editor widths there is no safe single top-row slot between the
   centered Diagram/Board notch and Sketch's right action group. Move the
   title to a second row instead of letting it cover either control. */
@media (max-width: 1160px) {
  .drawio-header--board {
    top: 70px;
    right: 12px !important;
    width: min(18rem, calc(100vw - 24px));
    max-width: calc(100vw - 24px);
  }
}
</style>
