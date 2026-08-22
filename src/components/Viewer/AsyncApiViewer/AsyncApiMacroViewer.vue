<!--
  AsyncAPI macro viewer wrapper. Renders inside GenericViewer so it
  inherits the host's title bar (Edit / Fullscreen), export-PNG button,
  versions, copy-link, etc. The actual spec rendering is delegated to
  @asyncapi/react-component via ReactDOM.render into a slot div.
-->
<template>
  <generic-viewer :wide="true" :hideHeader="hideHeader" :hideEdit="hideEdit">
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
import { trackRenderTime } from '@/utils/analytics/trackRenderTime'

export default defineComponent({
  name: 'AsyncApiMacroViewer',
  components: { GenericViewer },
  props: {
    doc: { type: Object as PropType<Diagram | null>, default: null },
    hideHeader: { type: Boolean, default: false },
    // Embed macro path: suppress the GenericViewer Edit pencil. An embed is a
    // reference — its content is edited at the source doc, and re-targeting
    // which doc is embedded is a page-editor operation.
    hideEdit: { type: Boolean, default: false },
    // Propagated from forge-asyncapi-viewer when getCustomContentByIdV2
    // fails (404, type-filtered, etc.) — surfaces a real error in the
    // viewer instead of the misleading "no saved spec yet" empty state.
    loadError: { type: String, default: undefined },
  },
  data() {
    return { renderReported: false }
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
      ReactDOM.render(
        React.createElement(AsyncApiReactView, { spec, loadError: this.loadError }),
        root,
      )
      this.reportRenderOnce()
    },
    reportRenderOnce() {
      if (this.renderReported) return
      if (!this.doc && !this.loadError) return
      this.renderReported = true
      // @asyncapi/react-component renders asynchronously internally — this
      // measures time-to-content, not time-to-full-paint. Same approximation
      // as OpenApiViewer's trackRenderTime call.
      trackRenderTime('asyncapi', this.$store.getters.isDisplayMode)
    },
  },
})
</script>

<style scoped>
.asyncapi-react-root {
  width: 100%;
}
</style>
