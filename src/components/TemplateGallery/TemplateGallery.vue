<template>
  <div
    v-if="visible"
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    data-testid="template-gallery-backdrop"
    @click.self="$emit('close')"
    @keydown.esc="$emit('close')"
  >
    <div
      class="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-lg bg-white shadow-xl"
      role="dialog"
      aria-modal="true"
      aria-labelledby="template-gallery-title"
      data-testid="template-gallery"
    >
      <header class="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <div>
          <h2 id="template-gallery-title" class="text-base font-semibold text-gray-900">
            Starter templates
          </h2>
          <p class="text-xs text-gray-500">{{ label }} &middot; pick one, then tweak it</p>
        </div>
        <button
          type="button"
          class="text-xl leading-none text-gray-400 hover:text-gray-600"
          aria-label="Close template gallery"
          data-testid="template-gallery-close"
          @click="$emit('close')"
        >&times;</button>
      </header>

      <div class="grid grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2">
        <article
          v-for="t in templates"
          :key="t.id"
          class="flex flex-col rounded-md border border-gray-200 p-3 transition-colors hover:border-gray-300 hover:bg-gray-50"
          data-testid="template-card"
        >
          <h3 class="text-sm font-medium text-gray-900">{{ t.name }}</h3>
          <p class="mt-1 flex-grow text-xs text-gray-500">{{ t.description }}</p>
          <button
            type="button"
            class="mt-3 self-start rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            data-testid="template-use-button"
            @click="$emit('select', t)"
          >Use this template</button>
        </article>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { DiagramType } from '@/model/Diagram/Diagram';
import { getDiagramConfig } from '@/model/Diagram/DiagramTypeConfig';
import { getTemplatesForType, type EditorTemplate } from '@/model/Diagram/EditorTemplates';

const props = defineProps<{
  visible: boolean;
  diagramType: DiagramType;
}>();

defineEmits<{
  (e: 'close'): void;
  (e: 'select', template: EditorTemplate): void;
}>();

const templates = computed(() => getTemplatesForType(props.diagramType));
const label = computed(() => getDiagramConfig(props.diagramType)?.label ?? props.diagramType);
</script>
