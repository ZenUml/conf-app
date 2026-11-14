<!--
  MCP promo for the editors that are not Workspace.vue: the Graph (draw.io),
  OpenAPI (Swagger) and AsyncAPI (Studio) editors. Same rules, events and
  copy as Workspace's two placements (useEditorMcpPromo), but both float over
  the editor in one corner, because these editors own their whole layout and
  have no code pane to dock the tip into.

  The host feeds the diagram's current source as `code`; the composable
  compares it with the source it first saw to tell a new, untouched diagram
  from one the author has started, and counts edits for the tip.
-->
<template>
  <div class="editor-mcp-promo" :class="`editor-mcp-promo--${corner}`">
    <McpPromoCard
      v-if="promo.showNewDiagramCard.value"
      title="Start from your code"
      :body="newDiagramBody"
      cta-label="Generate with AI (MCP)"
      @cta="promo.onCta('editor_new_diagram')"
      @dismiss="promo.onDismiss('editor_new_diagram')"
    />
    <McpPromoCard
      v-else-if="promo.showTip.value"
      variant="tip"
      title="Skip the manual work — let Claude or Cursor write this from your code."
      cta-label="Connect MCP Server"
      @cta="promo.onCta('editor_tip')"
      @dismiss="promo.onDismiss('editor_tip')"
    />
  </div>
  <div v-if="promo.dialogVisible.value" class="editor-mcp-promo-dialog-layer">
    <ConnectMcpDialog
      :visible="promo.dialogVisible.value"
      :diagram-title="diagramTitle"
      :cloud-id="promo.dialogTarget.value.cloudId"
      :page-id="promo.dialogTarget.value.pageId"
      :content-id="promo.dialogTarget.value.contentId"
      :prompt="promo.dialogPrompt.value"
      @close="promo.closeDialog"
      @copy="promo.onCopied"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, toRef } from 'vue'
import McpPromoCard from '@/components/AgentLink/McpPromoCard.vue'
import ConnectMcpDialog from '@/components/AgentLink/ConnectMcpDialog.vue'
import { useEditorMcpPromo } from '@/composables/agentLink/useEditorMcpPromo'

const props = withDefaults(defineProps<{
  diagramType: string
  /** The diagram's current source, updated as the author edits. */
  code: string
  /** The saved diagram's id; empty for a diagram not saved yet. */
  diagramId?: string
  diagramTitle?: string
  /** Which corner of the editor the cards sit in, clear of its own controls. */
  corner?: 'bottom-left' | 'bottom-right'
}>(), { diagramId: '', diagramTitle: '', corner: 'bottom-right' })

const promo = useEditorMcpPromo({
  diagramType: toRef(props, 'diagramType'),
  code: toRef(props, 'code'),
  diagramId: computed(() => props.diagramId || undefined),
})

// What "paste it here" means differs by editor: draw.io takes pasted XML on
// its canvas, the spec editors take the YAML or JSON in their code pane.
const newDiagramBody = computed(() => (props.diagramType === 'graph'
  ? 'Let Claude, Cursor or VS Code draft this diagram from your codebase as draw.io XML, then paste it onto the canvas.'
  : 'Let Claude, Cursor or VS Code draft this spec from your codebase, then paste it here.'))
</script>

<style scoped>
.editor-mcp-promo {
  position: fixed;
  bottom: 24px;
  z-index: 50;
}
.editor-mcp-promo--bottom-right { right: 24px; }
.editor-mcp-promo--bottom-left { left: 24px; }
.editor-mcp-promo:empty { display: none; }
.editor-mcp-promo-dialog-layer {
  position: fixed;
  inset: 0;
  z-index: 60;
}
</style>
