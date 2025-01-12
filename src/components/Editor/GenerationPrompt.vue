<template>
  <div
    class="fixed top-0 left-0 right-0 bottom-0 bg-[rgba(255,255,255,.9)]"
    :class="{ hidden: !visible }"
  >
    <div
      class="w-[630px] absolute top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] p-6 bg-white shadow-md border-[1px] border-solid border-slate-500"
    >
      <div class="mb-4 text-xl"> Generate Diagram </div>
      <div class="text-gray-500 flex gap-1">
        <div>
          Use AI to generate a diagram based on the content of the current page?
        </div>
      </div>
      <Button
        title="Generate based on specific content instead of the full page."
        class="text-sm flex items-center gap-1 !px-2 mt-2"
        @click="toggleUserPrompt"
      >
        <span>
          Extra prompt
        </span>
        <span :class="`${propmtOpen ? '' : 'rotate-180'}`">
          <svg  xmlns="http://www.w3.org/2000/svg"  width="18"  height="18"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="2"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-chevrons-up"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 11l5 -5l5 5" /><path d="M7 17l5 -5l5 5" /></svg>
        </span>
      </Button>
      <div v-if="propmtOpen">
        <textarea
          v-model="userPrompt"
          class="w-full h-32 mt-4 p-2 border-[1px] border-solid border-slate-500 focus:outline-[#0C66E4]"
          placeholder="Describe your requirements here..."
        ></textarea>
      </div>
      <div class="flex justify-between mt-6">
        <Button class="mr-6" @click="() => handleConfirm(undefined)" >Use Example</Button >
        <Button type="primary" @click="() => handleConfirm('sequence')" >Generate Sequence</Button >
        <Button type="primary" @click="() => handleConfirm('mermaid')" >Generate Mermaid</Button >
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "@/components/AUI/Button.vue";

export default defineComponent({
  props: {
    onConfirm: {
      type: Function,
      default: () => {}
    },
  },
  data: () => ({
    visible: true,
    propmtOpen: false,
    userPrompt: ''
  }),
  methods: {
    handleConfirm(value: string | undefined) {
      if (this.$props.onConfirm) {
        this.$props.onConfirm(value, this.userPrompt);
      }
      this.visible = false;
    },
    toggleUserPrompt() {
      this.propmtOpen = !this.propmtOpen;
    }
  },
  components: {
    Button
  }
});
</script>
