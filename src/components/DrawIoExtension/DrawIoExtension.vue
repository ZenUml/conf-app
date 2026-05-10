<template>
  <DrawIoHeader
    ref="headerRef"
    :title="title"
    :error="titleError"
    @titleChange="handleTitleChange"
    @titleConfirm="handleTitleConfirm"
  />
</template>

<script lang="ts">
import { defineComponent, onMounted, ref } from "vue";
import DrawIoHeader from "./components/DrawIoHeader.vue";

export default defineComponent({
  components: {
    DrawIoHeader
  },
  props: {
    doc: {
      type: Object
    }
  },
  setup(props) {
    const title = ref("Untitled");
    const titleError = ref(false);
    const headerRef = ref<InstanceType<typeof DrawIoHeader>>();
    let pendingResolve: ((value: string) => void) | null = null;

    const handleTitleChange = (value: string) => {
      title.value = value;
      window.diagram.title = value;
      if (value) {
        titleError.value = false;
      }
      if (value && pendingResolve) {
        pendingResolve(value);
        pendingResolve = null;
      }
    };

    const handleTitleConfirm = () => {
      if (title.value && pendingResolve) {
        pendingResolve(title.value);
        pendingResolve = null;
      }
    };

    const ensureTitle = (): Promise<string> => {
      if (window.diagram?.title) {
        return Promise.resolve(window.diagram.title);
      }
      titleError.value = true;
      headerRef.value?.focusInput();
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    };

    onMounted(() => {
      if (props.doc?.id && props.doc.title) {
        title.value = props.doc.title;
      }
      window.ensureTitle = ensureTitle;
    });

    return {
      title,
      titleError,
      headerRef,
      handleTitleChange,
      handleTitleConfirm
    };
  }
});
</script>

<style scoped></style>
