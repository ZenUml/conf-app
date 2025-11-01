<template>
  <generic-viewer :wide="autoResize===true || diagramType===DiagramType.Mermaid" :hideHeader="hideHeader" :hideUpgradeBanner="hideUpgradeBanner">
    <mermaid v-if="diagramType===DiagramType.Mermaid"></mermaid>
    <sequence v-if="diagramType===DiagramType.Sequence" :autoResize="autoResize"></sequence>
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
    autoResize: {
      type: Boolean,
      default: false
    },
    hideHeader: {
      type: Boolean,
      default: false
    },
    hideUpgradeBanner: {
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
