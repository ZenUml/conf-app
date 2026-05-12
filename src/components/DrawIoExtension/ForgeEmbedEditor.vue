<template>
  <div id="forge-embed-editor">
    <DocumentList />
  </div>
</template>

<script>
import DocumentList from '@/components/DocumentList/DocumentList.vue';
import EventBus from '@/EventBus';

export default {
  name: "ForgeEmbedEditor",
  components: {
    DocumentList
  },
  props: {
    saveEmbedAndExit: Function,
    exit: Function,
    doc: Object
  },
  mounted() {
    // Listen on EventBus — `save-embed` and `exit` are emitted there from
    // DocumentList.vue and Header.vue. (Pre-migration these were registered
    // on `this.$root.$on(...)`, which under Vue 2 only catches descendant-
    // bubbled `$emit`s — the EventBus channel never reached them, so the
    // listeners were dead. Switching to EventBus actually wires them up.)
    EventBus.$on('save-embed', async (selectedContent) => {
      console.log('embed editor - save', selectedContent);
      if (this.saveEmbedAndExit && selectedContent?.id) {
        await this.saveEmbedAndExit(selectedContent.id);
      }
    });

    EventBus.$on('exit', async (showWarning) => {
      if (this.exit) {
        if (showWarning) {
          console.warn('Warning: User is trying to exit without saving');
          await this.exit();
        } else {
          await this.exit();
        }
      }
    });
  }
}
</script>

<style scoped>
#forge-embed-editor {
  width: 100%;
  height: 100%;
}
</style> 