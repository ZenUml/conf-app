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
        <span>{{ message }}</span>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button
          type="button"
          data-testid="foreign-dialect-switch"
          class="bg-amber-600 hover:bg-amber-700 text-white px-3 py-1 rounded text-sm"
          @click="switchDialect"
        >
          {{ switchLabel }}
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
// #373: a foreign-dialect source (PlantUML or, since 2026-09-08, Mermaid)
// pasted into a ZenUML sequence macro parses without error but renders
// wrong-but-plausible nonsense or raw ANTLR parser text (see
// detectForeignDialect.ts for the rationale, dialect by dialect). This hint
// is purely additive — it never touches what zenuml.render() produces
// (Sequence.vue is untouched) — it only tells the user their source looks
// like the wrong dialect and offers a one-click route to the macro that
// actually understands it.
//
// Editor-only by design: the switch action needs the diagram-type store state
// this editor owns (diagram.code / diagram.plantUmlCode / diagram.mermaidCode
// / diagram.diagramType), which only exists on this surface — the read-only
// viewer has no type switcher to route to, so showing the hint there would be
// a dead end.
import { computed, ref, watch } from "vue";
import { useStore } from "vuex";
import { DiagramType } from "@/model/Diagram/Diagram";
import {
  commentOutLeadingText,
  detectForeignContentInMermaid,
  detectForeignDialect,
  extractMermaidSource,
  toMarkdownDocument,
} from "@/model/Diagram/detectForeignDialect";
import { stripMarkdownFence } from "@/model/Diagram/markdownFence";
import { trackAnalyticsEvent } from "@/utils/analytics/trackAnalyticsEvent";

const store = useStore();

const isSequence = computed(() => store.state.diagram.diagramType === DiagramType.Sequence);
// Mermaid macros too (AI Repair failures, 2026-10-20..11-19): PlantUML or
// prose above the opener in a Mermaid macro reaches AI Repair as
// "No diagram type detected", which no in-language repair can fix.
const isMermaid = computed(() => store.state.diagram.diagramType === DiagramType.Mermaid);
const code = computed(() => {
  if (isSequence.value) return store.state.diagram.code;
  if (isMermaid.value) return store.state.diagram.mermaidCode;
  return "";
});
// "markdown" names the leading-prose case in analytics (detected_dialect is
// a MacroTypeValue); the action keeps the Mermaid tab and comments the prose.
const detectedDialect = computed(() => {
  if (isSequence.value) return detectForeignDialect(code.value);
  if (isMermaid.value) {
    const found = detectForeignContentInMermaid(code.value);
    if (found === "markdown_document") {
      // Never overwrite what the author already has in the Markdown tab.
      const existing = store.state.diagram.markdownCode;
      return existing === undefined || existing === "" ? "markdown" : null;
    }
    return found === "leading_text" ? "markdown" : found;
  }
  return null;
});

const DIALECT_COPY = {
  plantuml: {
    message: "This looks like PlantUML, not ZenUML — it will render, but the lifelines will be wrong.",
    switchLabel: "Switch to PlantUML",
  },
  mermaid: {
    message: "This looks like Mermaid, not ZenUML — switch to the Mermaid tab to render it.",
    switchLabel: "Switch to Mermaid",
  },
};

const MERMAID_MACRO_COPY = {
  plantuml: {
    message: "This looks like PlantUML, not Mermaid — switch to the PlantUML tab to render it.",
    switchLabel: "Switch to PlantUML",
  },
  markdown: {
    message: "Text above the diagram type stops Mermaid from reading the diagram.",
    switchLabel: "Turn it into comments",
  },
};

const MARKDOWN_DOCUMENT_COPY = {
  message: "This looks like a Markdown document with several diagrams — switch to the Markdown tab to render it.",
  switchLabel: "Switch to Markdown",
};

const isMarkdownDocument = computed(
  () => isMermaid.value && detectForeignContentInMermaid(code.value) === "markdown_document",
);

const copy = computed(() =>
  isMarkdownDocument.value
    ? MARKDOWN_DOCUMENT_COPY
    : (isMermaid.value ? MERMAID_MACRO_COPY : DIALECT_COPY)[detectedDialect.value]);
const message = computed(() => copy.value?.message ?? "");
const switchLabel = computed(() => copy.value?.switchLabel ?? "");

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
    macro_type: isMermaid.value ? DiagramType.Mermaid : DiagramType.Sequence,
    detected_dialect: detectedDialect.value,
    has_markdown_fence: stripMarkdownFence(code.value).fenced,
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

function switchDialect() {
  trackAnalyticsEvent("foreign_dialect_hint_switch_clicked", baseProps());
  const source = code.value;
  if (isMarkdownDocument.value) {
    store.commit("updateMarkdownCode", toMarkdownDocument(source));
    store.commit("updateDiagramType", DiagramType.Markdown);
  } else if (isMermaid.value && detectedDialect.value === "markdown") {
    store.dispatch("updateMermaidCode", commentOutLeadingText(source));
  } else if (detectedDialect.value === "mermaid") {
    store.dispatch("updateMermaidCode", extractMermaidSource(source) ?? source);
    store.commit("updateDiagramType", DiagramType.Mermaid);
  } else {
    store.dispatch("updatePlantUmlCode", source);
    store.commit("updateDiagramType", DiagramType.PlantUml);
  }
  // Editor.vue's error-clearing watcher keys off its `code` computed's VALUE.
  // Since that source string is unchanged across this switch (it just moved
  // to the target dialect's own field), the watcher never fires and the
  // stale Sequence-tab error would otherwise survive into the new tab. Clear
  // it explicitly instead of relying on that watcher (#642).
  store.commit("updateError", null);
}

defineExpose({ visible, detectedDialect });
</script>
