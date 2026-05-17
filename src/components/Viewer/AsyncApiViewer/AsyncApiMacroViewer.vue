<!--
  AsyncAPI macro viewer wrapper. Renders inside GenericViewer so it
  inherits the host's title bar (Edit / Fullscreen), export-PNG button,
  versions, copy-link, etc. The actual spec rendering is delegated to
  @asyncapi/react-component via ReactDOM.render into a slot div.
-->
<template>
  <generic-viewer :wide="true" :hideHeader="hideHeader">
    <div ref="reactRoot" class="asyncapi-react-root"></div>
  </generic-viewer>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue'
import React from 'react'
import ReactDOM from 'react-dom'
import GenericViewer from '@/components/Viewer/GenericViewer.vue'
import AsyncApiReactView from '@/components/Viewer/AsyncApiViewer/AsyncApiViewer'
import { Diagram } from '@/model/Diagram/Diagram'

export default defineComponent({
  name: 'AsyncApiMacroViewer',
  components: { GenericViewer },
  props: {
    doc: { type: Object as PropType<Diagram | null>, default: null },
    hideHeader: { type: Boolean, default: false },
  },
  mounted() {
    this.render()
  },
  beforeUnmount() {
    if (this.$refs.reactRoot) {
      ReactDOM.unmountComponentAtNode(this.$refs.reactRoot as HTMLElement)
    }
  },
  watch: {
    doc: {
      handler() {
        this.render()
      },
      deep: true,
    },
  },
  methods: {
    render() {
      const root = this.$refs.reactRoot as HTMLElement | undefined
      if (!root) return
      const spec = (this.doc as any)?.code as string | undefined
      ReactDOM.render(React.createElement(AsyncApiReactView, { spec }), root)
    },
  },
})
</script>

<style scoped>
.asyncapi-react-root {
  width: 100%;
}
</style>
