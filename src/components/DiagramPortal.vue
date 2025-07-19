<template>
  <generic-viewer :wide="useViewResizer===true || diagramType===DiagramType.Mermaid">
    <mermaid v-if="diagramType===DiagramType.Mermaid"></mermaid>
    <sequence v-if="diagramType===DiagramType.Sequence" :useViewResizer="useViewResizer"></sequence>
  </generic-viewer>
</template>
<script>
import GenericViewer from "@/components/Viewer/GenericViewer.vue";
import Sequence from "@/components/Sequence.vue";
import Mermaid from "@/components/Mermaid.vue";
import { DiagramType } from "@/model/Diagram/Diagram";

export default {
  name: "DiagramPortal",
  components: {Mermaid, Sequence, GenericViewer},
  props: {
    useViewResizer: {
      type: Boolean,
      default: false
    }
  },
  computed: {
    DiagramType() {
      return DiagramType;
    },
    diagramType() {
      return this.$store.state.diagram.diagramType;
    }
  }
}

</script>
