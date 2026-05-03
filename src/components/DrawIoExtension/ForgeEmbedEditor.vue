<template>
  <div id="forge-embed-editor">
    <DocumentList />
  </div>
</template>

<script>
import DocumentList from '@/components/DocumentList/DocumentList.vue';

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
    // Set up event listeners for the DocumentList component
    this.$root.$on('save-embed', async (selectedContent) => {
      console.log('embed editor - save', selectedContent);
      if (this.saveEmbedAndExit && selectedContent?.id) {
        await this.saveEmbedAndExit(selectedContent.id);
      }
    });

    this.$root.$on('exit', async (showWarning) => {
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
