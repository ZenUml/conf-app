<template>
  <generic-viewer :wide="autoResize===true" :hideHeader="hideHeader">
    <mermaid v-if="diagramType===DiagramType.Mermaid"></mermaid>
    <plant-uml v-if="diagramType===DiagramType.PlantUml"></plant-uml>
    <sequence v-if="diagramType===DiagramType.Sequence" :autoResize="autoResize"></sequence>
  </generic-viewer>
</template>
<script>
import GenericViewer from "@/components/Viewer/GenericViewer.vue";
import Sequence from "@/components/Sequence.vue";
import Mermaid from "@/components/Mermaid.vue";
import PlantUml from "@/components/PlantUml.vue";
import { DiagramType } from "@/model/Diagram/Diagram";

export default {
  name: "DiagramPortal",
  components: {Mermaid, PlantUml, Sequence, GenericViewer},
  props: {
    autoResize: {
      type: Boolean,
      default: false
    },
    hideHeader: {
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
