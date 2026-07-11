import { StoreOptions } from 'vuex';
import { RootState} from "@/model/store2/types";
import {DiagramType, NULL_DIAGRAM} from "@/model/Diagram/Diagram";
import globals from "@/model/globals";
import EventBus from "@/EventBus";

const ExtendedStore: StoreOptions<RootState> = {
  mutations: {
    updateCode2(state: any, payload: any) {
      state.diagram.code = payload
    },
    updateMermaidCode(state: any, payload: any) {
      state.diagram.mermaidCode = payload
    },
    updatePlantUmlCode(state: any, payload: any) {
      state.diagram.plantUmlCode = payload
    },
    updateDiagramType(state: any, payload: any) {
      state.diagram.diagramType = payload
    },
    updateTitle(state: any, payload: any) {
      state.diagram.title = payload.trim()
    },
    updateMetadata(state: any, payload: any) {
      state.diagram.metadata = payload
    },
    updateError(state: any, payload: any) {
      state.error = payload
    },
  },
  actions: {
    updateCode2({commit}: any, payload: any) {
      commit('updateCode2', payload)
    },
    updateMermaidCode({commit}: any, payload: any) {
      commit('updateMermaidCode', payload)
    },
    updatePlantUmlCode({commit}: any, payload: any) {
      commit('updatePlantUmlCode', payload)
    },
    updateDiagramType({commit}: any, payload: DiagramType) {
      commit('updateDiagramType', payload)
    },
    updateTitle({commit}: any, payload: any) {
      commit('updateTitle', payload)
    },
    updateMetadata({commit}: any, payload: any) {
      commit('updateMetadata', payload)
    },
    updateError({commit}: any, payload: any) {
      commit('updateError', payload)
    }
  },
  getters: {
    isDisplayMode: () => globals.apWrapper.isDisplayMode(),
  },
  state: {
    diagram: NULL_DIAGRAM,
    // Flipped true once the viewer's async loadDiagram() has resolved (success
    // OR failure). Lets the embed viewer distinguish "still loading" from
    // "loaded but nothing renderable" (deleted/missing referenced content) so
    // it shows a terminal error instead of spinning forever. Only ForgeEmbedViewer
    // reads it; other viewers ignore it.
    diagramLoadComplete: false,
    error: null,
    onElementClick: (codeRange: any) => {
      EventBus.$emit('highlight', codeRange)
    },
  }
}

export default ExtendedStore;
