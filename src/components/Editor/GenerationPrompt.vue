<template>
  <div
    class="fixed top-0 left-0 right-0 bottom-0 bg-[rgba(255,255,255,.9)] text-slate-800"
    :class="{ hidden: !visible }"
  >
    <div
      class="w-[630px] absolute top-[50%] left-[50%] translate-x-[-50%] translate-y-[-50%] p-6 bg-white shadow-[0px_0px_1px_0px_#091E424F,0px_3px_5px_0px_#091E4233] rounded"
    >
      <div class="mb-1 text-xl font-semibold">ZenUML diagram</div>
      <div class="mb-4 text-sm">
        We are now providing two ways to help you create your diagram.
      </div>
      <div class="font-semibold text-sm">Manual Mode</div>
      <div class="text-xs text-gray-500 mb-4">
        Opens our classic editor where you can manually craft and customize your
        diagram.
      </div>
      <Button
        class="px-4 py-1.5 !bg-gray-100 !text-slate-600 !font-medium !text-sm"
        @click="() => handleConfirm(undefined)"
      >
        Open Editor
      </Button>
      <div class="border-b border-gray-200 my-4" />
      <div class="flex items-center gap-1 leading-none mb-1">
        <IconSpark />
        <div class="font-semibold">AI-assisted mode</div>
      </div>
      <div class="text-xs text-gray-500 mb-5">
        We’ll use AI to summarize and organize your page content, then transform
        it <br />
        into a diagram.
      </div>
      <div>
        <div class="text-xs font-semibold text-gray-500">Select Your Diagram Style:</div>
        <div class="p-1">
          <div
            class="flex items-center gap-2 mb-1 cursor-pointer"
            @click="diagramType = 'sequence'"
          >
            <div
              :class="{
                'h-4 w-4 rounded-full': true,
                'border-[6px] border-solid border-primary':
                  diagramType === 'sequence',
                'border-2 border-solid border-gray-200':
                  diagramType !== 'sequence',
              }"
              @click="diagramType = 'sequence'"
            />
            <div class="text-center text-sm">Sequence Diagram</div>
          </div>
          <div
            class="flex items-center gap-2 cursor-pointer"
            @click="diagramType = 'mermaid'"
          >
            <div
              :class="{
                'h-4 w-4 rounded-full': true,
                'border-[6px] border-solid border-primary':
                  diagramType === 'mermaid',
                'border-2 border-solid border-gray-200':
                  diagramType !== 'mermaid',
              }"
              @click="diagramType = 'mermaid'"
            />
            <div class="text-center text-sm">Mermaid Diagram</div>
          </div>
        </div>
      </div>
      <Button
        title="Generate based on specific content instead of the full page."
        class="flex items-center gap-1 !px-2 mt-4 !bg-gray-100 !py-0.5 !font-medium !text-sm"
        @click="toggleUserPrompt"
      >
        <span :class="`${promptOpen ? '' : 'rotate-180'}`">
          <IconChevron width="14" height="14" />
        </span>
        <span> Extra prompt input </span>
      </Button>
      <div v-if="promptOpen">
        <textarea
          v-model="userPrompt"
          class="w-full h-32 mt-4 p-2 border-[1px] border-solid border-slate-400 focus:outline-[#0C66E4] text-sm rounded"
          placeholder="Describe your requirements here..."
        ></textarea>
      </div>
      <div class="text-xs mb-6 mt-2">
        Extra prompt (optional) may make your diagram even more concise or
        adjust the focus.
      </div>
      <div class="flex justify-end">
        <Button type="primary" class="!text-sm" @click="() => handleConfirm(diagramType)">
          <svg
            v-if="loading"
            style="display: inline-block; margin-right: 3px"
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            class="tabler-icon tabler-icon-loader-2 animate-spin relative -top-0.5"
          >
            <path d="M12 3a9 9 0 1 0 9 9"></path>
          </svg>
          Generate now
        </Button>
      </div>
      <div class="flex justify-end items-center text-xs gap-1 mt-2">
        <IconInfo width="16" height="16" />
        <div>Content quality may vary</div>
      </div>
      <div
        class="text-end text-xs py-3 px-6 border-t border-gray-200 -mx-6 -mb-6 mt-6"
      >
        Powered by ZenUML
      </div>
    </div>
  </div>
</template>

<script lang="ts">
import { defineComponent } from "vue";
import Button from "@/components/AUI/Button.vue";
import IconSpark from "@/components/icons/IconSpark.vue";
import IconChevron from "@/components/icons/IconChevron.vue";
import IconInfo from "@/components/icons/IconInfo.vue";
import {trackEvent} from "@/utils/window";

export default defineComponent({
  props: {
    onConfirm: {
      type: Function,
      default: () => {},
    },
  },
  data: () => ({
    visible: true,
    loading: false,
    promptOpen: false,
    userPrompt: "",
    diagramType: "sequence",
  }),
  methods: {
    async handleConfirm(value: string | undefined) {
      if (this.$props.onConfirm) {
        this.loading = true;
        await this.$props.onConfirm(value, this.userPrompt);
      }
      this.visible = false;
      trackEvent("", "Generate", "AI", { diagramType: value})
    },
    toggleUserPrompt() {
      this.promptOpen = !this.promptOpen;
    },
  },
  components: {
    Button,
    IconSpark,
    IconChevron,
    IconInfo,
  },
});
</script>
