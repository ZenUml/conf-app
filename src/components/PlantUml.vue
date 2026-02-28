<template>
  <div>
    <div v-if="loading" class="flex justify-center items-center py-8">
      <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-5 w-5 animate-spin text-primary"><path d="M12 3a9 9 0 1 0 9 9"></path></svg>
      <span class="ml-2">Rendering PlantUML...</span>
    </div>
    <div v-else-if="error" class="text-red-600 py-4 px-2 text-sm">{{ error }}</div>
    <div v-else class="flex justify-center" v-html="svg"></div>
  </div>
</template>

<script>
import { plantumlEncode } from '@/utils/plantuml/encode';
import { DiagramType } from '@/model/Diagram/Diagram';
import { trackEvent } from '@/utils/window';
import globals from '@/model/globals';
import EventBus from '@/EventBus';
import { debounce } from 'lodash';

const PLANTUML_SERVER = 'https://www.plantuml.com/plantuml/svg/';

export default {
  name: 'PlantUml',
  data() {
    return {
      svg: 'Empty',
      loading: false,
      error: null,
      debouncedRender: null,
    };
  },
  computed: {
    plantUmlCode() {
      return this.$store.state.diagram.diagramType === DiagramType.PlantUml && this.$store.state.diagram.plantUmlCode;
    },
  },
  async mounted() {
    this.debouncedRender = debounce(this.fetchSvg, 500);
    if (!this.plantUmlCode) return;
    await this.fetchSvg(this.plantUmlCode);
    EventBus.$emit('diagramLoaded', this.plantUmlCode, this.$store.state.diagram.diagramType);
    await globals.apWrapper.initializeContext();
    trackEvent('', 'view_macro', DiagramType.PlantUml);
  },
  beforeUnmount() {
    if (this.debouncedRender) {
      this.debouncedRender.cancel();
    }
  },
  watch: {
    plantUmlCode(newVal) {
      if (!newVal) {
        this.svg = 'Empty';
        this.error = null;
      } else {
        this.debouncedRender(newVal);
      }
    },
  },
  methods: {
    async fetchSvg(code) {
      if (!code) return;
      this.loading = true;
      this.error = null;
      try {
        const encoded = plantumlEncode(code);
        const response = await fetch(`${PLANTUML_SERVER}${encoded}`);
        if (!response.ok) {
          throw new Error(`PlantUML server returned ${response.status}`);
        }
        this.svg = await response.text();
      } catch (err) {
        console.error('PlantUML render error', err);
        this.error = `Failed to render PlantUML: ${err.message}`;
      } finally {
        this.loading = false;
      }
    },
  },
};
</script>
