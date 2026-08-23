<template>
  <div
    v-if="visible"
    class="foreign-dialect-container flex flex-col text-sm"
    data-testid="foreign-dialect-hint"
  >
    <div
      class="flex items-center justify-between gap-2 bg-amber-50 border-t border-amber-200 p-2 text-amber-900"
    >
      <div class="flex w-fit items-center gap-2">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
          class="size-5 text-amber-600 shrink-0"
          aria-hidden="true"
        >
          <path d="M12 9v4"></path>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"></path>
          <path d="M12 17h.01"></path>
        </svg>
        <span>This looks like PlantUML, not ZenUML — it will render, but the lifelines will be wrong.</span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          type="button"
          data-testid="foreign-dialect-switch"
          class="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded text-sm"
          @click="switchToPlantUml"
        >
          Switch to PlantUML
        </button>
        <button
          type="button"
          data-testid="foreign-dialect-dismiss"
          aria-label="Dismiss"
          class="text-amber-700 hover:text-amber-900 px-1"
          @click="dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  </div>
</template>

<script setup>
// #373: PlantUML pasted into a ZenUML sequence macro parses without error but
// renders wrong-but-plausible nonsense (see detectForeignDialect.ts for the
// rationale). This hint is purely additive — it never touches what
// zenuml.render() produces (Sequence.vue is untouched) — it only tells the
// user their source looks like the wrong dialect and offers a one-click route
// to the macro that actually understands it.
//
// Editor-only by design: the switch action needs the diagram-type store state
// this editor owns (diagram.code / diagram.plantUmlCode / diagram.diagramType),
// which only exists on this surface — the read-only viewer has no type
// switcher to route to, so showing the hint there would be a dead end.
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { DiagramType } from "@/model/Diagram/Diagram";
import { detectForeignDialect } from "@/model/Diagram/detectForeignDialect";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

const store = useStore();

const isSequence = computed(() => store.state.diagram.diagramType === DiagramType.Sequence);
const code = computed(() => (isSequence.value ? store.state.diagram.code : ""));
const detectedDialect = computed(() => (isSequence.value ? detectForeignDialect(code.value) : null));

// Dismissal is scoped to the exact source that triggered it: editing the
// pasted text (or pasting something new) surfaces the hint again rather than
// permanently silencing it for the rest of the editing session.
const dismissedForCode = ref(null);
const visible = computed(
  () => !!detectedDialect.value && dismissedForCode.value !== code.value
);

function baseProps() {
  return {
    feature_area: "macro",
    surface: "editor",
    macro_type: DiagramType.Sequence,
    detected_dialect: detectedDialect.value,
  };
}

watch(visible, (isVisible, wasVisible) => {
  if (isVisible && !wasVisible) {
    trackAnalyticsEvent("foreign_dialect_hint_shown", baseProps());
  }
});

function dismiss() {
  trackAnalyticsEvent("foreign_dialect_hint_dismissed", baseProps());
  dismissedForCode.value = code.value;
}

function switchToPlantUml() {
  trackAnalyticsEvent("foreign_dialect_hint_switch_clicked", baseProps());
  const source = code.value;
  store.dispatch("updatePlantUmlCode", source);
  store.commit("updateDiagramType", DiagramType.PlantUml);
}

defineExpose({ visible, detectedDialect });
</script>
