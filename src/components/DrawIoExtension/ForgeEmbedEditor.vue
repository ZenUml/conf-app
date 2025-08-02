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
    this.$root.$on('save', async (selectedContent) => {
      if (this.saveEmbedAndExit && selectedContent?.id) {
        await this.saveEmbedAndExit(selectedContent.id);
      }
    });

    this.$root.$on('exit', async (showWarning) => {
      if (this.exit) {
        if (showWarning) {
          // Show warning dialog
          // @ts-ignore
          AP.dialog.create({
            key: 'zenuml-close-without-saving-dialog',
            width: 500,
            height: 300,
            chrome: false,
          }).on('close', (data) => {
            if (data.action === 'discard') {
              this.exit();
            }
          });
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