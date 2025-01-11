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
import { DiagramType } from "@/model/Diagram/Diagram";

export default defineComponent({
  props: {
    onConfirm: {
      type: Function,
      default: () => {}
    }
  },
  data: () => ({
    visible: true
  }),
  methods: {
    handleConfirm(value: string | undefined) {
      if (this.$props.onConfirm) {
        this.$props.onConfirm(value);
      }
      this.visible = false;
    }
  },
  components: {
    Button
  }
});
</script>
